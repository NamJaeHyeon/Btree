const fs = require('fs');
const assert = require('assert');

// ==========================================
// 1. 디스크 매니저 (4KB 블록 단위 I/O 처리)
// ==========================================
class DiskManager {
  constructor(filePath, t = 256) {
    this.filePath = filePath;
    this.blockSize = 4096; // 4KB (OS 페이지 크기)
    this.t = t;            // 차수 256 -> 최대 키 511개, 최대 자식 512개
    this.cache = new Map(); // I/O 최소화를 위한 간단한 인메모리 캐시

    if (fs.existsSync(filePath)) {
      this.fd = fs.openSync(filePath, 'r+');
      const header = Buffer.alloc(this.blockSize);
      fs.readSync(this.fd, header, 0, this.blockSize, 0);
      this.rootId = header.readInt32LE(4);
      this.totalBlocks = header.readInt32LE(8);
    } else {
      this.fd = fs.openSync(filePath, 'w+');
      this.rootId = 1;
      this.totalBlocks = 2; // Block 0: 슈퍼블록, Block 1: 루트 노드
      this.writeHeader();
      
      const root = { id: 1, isLeaf: true, keys: [], children: [] };
      this.writeNode(root);
    }
  }

  writeHeader() {
    const buf = Buffer.alloc(this.blockSize);
    buf.write("BTR3", 0, 4, "utf-8"); // Magic Number
    buf.writeInt32LE(this.rootId, 4);
    buf.writeInt32LE(this.totalBlocks, 8);
    fs.writeSync(this.fd, buf, 0, this.blockSize, 0);
  }

  allocateNode() {
    const newId = this.totalBlocks++;
    this.writeHeader();
    return newId;
  }

  readNode(id) {
    if (this.cache.has(id)) return this.cache.get(id);

    const buf = Buffer.alloc(this.blockSize);
    fs.readSync(this.fd, buf, 0, this.blockSize, id * this.blockSize);

    const isLeaf = buf.readUInt8(0) === 1;
    const numKeys = buf.readUInt16LE(2); // 0 ~ 511
    
    const keys = [];
    for (let i = 0; i < numKeys; i++) {
      keys.push(buf.readInt32LE(4 + i * 4));
    }
    
    const children = [];
    if (!isLeaf) {
      for (let i = 0; i <= numKeys; i++) {
        children.push(buf.readInt32LE(2048 + i * 4));
      }
    }

    const node = { id, isLeaf, keys, children };
    this.cache.set(id, node);
    return node;
  }

  writeNode(node) {
    const buf = Buffer.alloc(this.blockSize);
    buf.writeUInt8(node.isLeaf ? 1 : 0, 0);
    buf.writeUInt16LE(node.keys.length, 2);

    for (let i = 0; i < node.keys.length; i++) {
      buf.writeInt32LE(node.keys[i], 4 + i * 4);
    }
    
    if (!node.isLeaf) {
      for (let i = 0; i < node.children.length; i++) {
        buf.writeInt32LE(node.children[i], 2048 + i * 4);
      }
    }

    fs.writeSync(this.fd, buf, 0, this.blockSize, node.id * this.blockSize);
    this.cache.set(node.id, node);
  }

  close() {
    fs.closeSync(this.fd);
  }
}

// ==========================================
// 2. Disk-based B-Tree 구현부 (t=256)
// ==========================================
class BTree {
  constructor(filePath) {
    this.dm = new DiskManager(filePath, 256);
    this.t = this.dm.t;
  }

  search(key, nodeId = this.dm.rootId) {
    const node = this.dm.readNode(nodeId);
    let i = 0;
    while (i < node.keys.length && key > node.keys[i]) i++;
    if (i < node.keys.length && key === node.keys[i]) return true;
    if (node.isLeaf) return false;
    return this.search(key, node.children[i]);
  }

  insert(key) {
    let r = this.dm.readNode(this.dm.rootId);
    if (r.keys.length === 2 * this.t - 1) {
      const sId = this.dm.allocateNode();
      const s = { id: sId, isLeaf: false, keys: [], children: [r.id] };
      
      this.dm.rootId = s.id;
      this.dm.writeHeader();
      this.dm.writeNode(s);

      this.splitChild(s, 0, r);
      this.insertNonFull(s, key);
    } else {
      this.insertNonFull(r, key);
    }
  }

  splitChild(parent, i, child) {
    const zId = this.dm.allocateNode();
    const z = { id: zId, isLeaf: child.isLeaf, keys: [], children: [] };

    parent.children.splice(i + 1, 0, z.id);
    parent.keys.splice(i, 0, child.keys[this.t - 1]);

    z.keys = child.keys.slice(this.t);
    child.keys = child.keys.slice(0, this.t - 1);

    if (!child.isLeaf) {
      z.children = child.children.slice(this.t);
      child.children = child.children.slice(0, this.t);
    }

    this.dm.writeNode(child);
    this.dm.writeNode(z);
    this.dm.writeNode(parent);
  }

  insertNonFull(node, key) {
    let i = node.keys.length - 1;
    if (node.isLeaf) {
      while (i >= 0 && key < node.keys[i]) i--;
      node.keys.splice(i + 1, 0, key);
      this.dm.writeNode(node);
    } else {
      while (i >= 0 && key < node.keys[i]) i--;
      i++;
      let child = this.dm.readNode(node.children[i]);
      if (child.keys.length === 2 * this.t - 1) {
        this.splitChild(node, i, child);
        if (key > node.keys[i]) i++;
        child = this.dm.readNode(node.children[i]);
      }
      this.insertNonFull(child, key);
    }
  }

  delete(key) {
    let root = this.dm.readNode(this.dm.rootId);
    if (root.keys.length === 0) return;

    this._delete(root, key);

    root = this.dm.readNode(this.dm.rootId);
    if (root.keys.length === 0 && !root.isLeaf) {
      this.dm.rootId = root.children[0];
      this.dm.writeHeader();
    }
  }

  _delete(node, key) {
    let idx = 0;
    while (idx < node.keys.length && node.keys[idx] < key) idx++;

    if (idx < node.keys.length && node.keys[idx] === key) {
      if (node.isLeaf) {
        node.keys.splice(idx, 1);
        this.dm.writeNode(node);
      } else {
        this.removeFromNonLeaf(node, idx);
      }
    } else {
      if (node.isLeaf) return;

      const flag = (idx === node.keys.length);
      let child = this.dm.readNode(node.children[idx]);

      if (child.keys.length < this.t) {
        this.fill(node, idx);
      }

      if (flag && idx > node.keys.length) {
        this._delete(this.dm.readNode(node.children[idx - 1]), key);
      } else {
        this._delete(this.dm.readNode(node.children[idx]), key);
      }
    }
  }

  removeFromNonLeaf(node, idx) {
    const k = node.keys[idx];
    let leftChild = this.dm.readNode(node.children[idx]);
    let rightChild = this.dm.readNode(node.children[idx + 1]);

    if (leftChild.keys.length >= this.t) {
      const pred = this.getPred(node, idx);
      node.keys[idx] = pred;
      this.dm.writeNode(node);
      this._delete(leftChild, pred);
    } else if (rightChild.keys.length >= this.t) {
      const succ = this.getSucc(node, idx);
      node.keys[idx] = succ;
      this.dm.writeNode(node);
      this._delete(rightChild, succ);
    } else {
      this.merge(node, idx);
      leftChild = this.dm.readNode(node.children[idx]);
      this._delete(leftChild, k);
    }
  }

  getPred(node, idx) {
    let curr = this.dm.readNode(node.children[idx]);
    while (!curr.isLeaf) curr = this.dm.readNode(curr.children[curr.keys.length]);
    return curr.keys[curr.keys.length - 1];
  }

  getSucc(node, idx) {
    let curr = this.dm.readNode(node.children[idx + 1]);
    while (!curr.isLeaf) curr = this.dm.readNode(curr.children[0]);
    return curr.keys[0];
  }

  fill(node, idx) {
    let cPrev = idx !== 0 ? this.dm.readNode(node.children[idx - 1]) : null;
    let cNext = idx !== node.keys.length ? this.dm.readNode(node.children[idx + 1]) : null;

    if (idx !== 0 && cPrev.keys.length >= this.t) {
      this.borrowFromPrev(node, idx);
    } else if (idx !== node.keys.length && cNext.keys.length >= this.t) {
      this.borrowFromNext(node, idx);
    } else {
      if (idx !== node.keys.length) this.merge(node, idx);
      else this.merge(node, idx - 1);
    }
  }

  borrowFromPrev(node, idx) {
    let child = this.dm.readNode(node.children[idx]);
    let sibling = this.dm.readNode(node.children[idx - 1]);

    child.keys.unshift(node.keys[idx - 1]);
    if (!child.isLeaf) child.children.unshift(sibling.children.pop());
    node.keys[idx - 1] = sibling.keys.pop();

    this.dm.writeNode(child);
    this.dm.writeNode(sibling);
    this.dm.writeNode(node);
  }

  borrowFromNext(node, idx) {
    let child = this.dm.readNode(node.children[idx]);
    let sibling = this.dm.readNode(node.children[idx + 1]);

    child.keys.push(node.keys[idx]);
    if (!child.isLeaf) child.children.push(sibling.children.shift());
    node.keys[idx] = sibling.keys.shift();

    this.dm.writeNode(child);
    this.dm.writeNode(sibling);
    this.dm.writeNode(node);
  }

  merge(node, idx) {
    let child = this.dm.readNode(node.children[idx]);
    let sibling = this.dm.readNode(node.children[idx + 1]);

    child.keys.push(node.keys[idx]);
    child.keys.push(...sibling.keys);
    if (!child.isLeaf) child.children.push(...sibling.children);

    node.keys.splice(idx, 1);
    node.children.splice(idx + 1, 1);

    this.dm.writeNode(child);
    this.dm.writeNode(node);
  }

  close() {
    this.dm.close();
  }
}

// ==========================================
// 3. 테스트 시나리오 및 실행부
// ==========================================
const TAG_FILE = 'tag.csv';
const DB_FILE = 'tree.btree';
const TOTAL_ITEMS = 10000;

console.log("==================================================");
console.log("🚀 4KB 디스크 최적화 B-Tree 영속성 테스트 (t=256)");
console.log("==================================================\n");

// [Step 1] 테스트 데이터를 tag.csv 에 생성
console.log(`[1/5] ${TAG_FILE} 더미 데이터 생성 중...`);
const data = Array.from({ length: TOTAL_ITEMS }, (_, i) => i + 1);
for (let i = data.length - 1; i > 0; i--) { // 섞기
  const j = Math.floor(Math.random() * (i + 1));
  [data[i], data[j]] = [data[j], data[i]];
}
fs.writeFileSync(TAG_FILE, "key\n" + data.join("\n"));
console.log(`      -> ${TOTAL_ITEMS}개의 레코드 기록 완료.\n`);

// [Step 2] tag.csv 읽어와서 DB 구축 (디스크 기록)
if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE); // 기존 DB 제거
console.log(`[2/5] ${TAG_FILE} 읽어들여 ${DB_FILE} 구축 (Insert) 중...`);
let btree = new BTree(DB_FILE);

console.time("      -> 10,000개 디스크 삽입 소요 시간");
const csvLines = fs.readFileSync(TAG_FILE, 'utf-8').trim().split('\n').slice(1);
for (const line of csvLines) {
  btree.insert(parseInt(line, 10));
}
console.timeEnd("      -> 10,000개 디스크 삽입 소요 시간");
btree.close(); // 메모리에서 내림
console.log("      -> B-Tree 닫음 (메모리 플러시)\n");

// [Step 3] 프로그램 재시작 시뮬레이션: 파일에서 다시 읽어들여 탐색
console.log(`[3/5] ${DB_FILE} 재연결 후 영속성 검증 (Search)...`);
btree = new BTree(DB_FILE);
console.time("      -> 10,000개 디스크 탐색 소요 시간");
for (let i = 1; i <= TOTAL_ITEMS; i++) {
  assert.strictEqual(btree.search(i), true, `영속성 오류: 키 ${i}를 찾을 수 없습니다!`);
}
console.timeEnd("      -> 10,000개 디스크 탐색 소요 시간");
console.log(`      -> 데이터 100% 디스크에서 복원 완료.\n`);

// [Step 4] 무작위 5,000개 삭제
console.log(`[4/5] 5,000개 무작위 삭제 진행 중...`);
const keysToDelete = data.slice(0, 5000);
const keysToKeep = data.slice(5000);

console.time("      -> 5,000개 디스크 삭제 소요 시간");
for (const key of keysToDelete) {
  btree.delete(key);
}
console.timeEnd("      -> 5,000개 디스크 삭제 소요 시간");

// [Step 5] 삭제 무결성 체크
console.log(`\n[5/5] 삭제 이후 디스크 무결성 확인...`);
for (const key of keysToDelete) {
  assert.strictEqual(btree.search(key), false, `삭제된 키 ${key}가 여전히 존재합니다!`);
}
for (const key of keysToKeep) {
  assert.strictEqual(btree.search(key), true, `유지되어야 할 키 ${key}가 사라졌습니다!`);
}

const stats = fs.statSync(DB_FILE);
console.log(`\n🎉 하드 테스트 완벽 통과!`);
console.log(`📂 생성된 DB 파일 크기: ${(stats.size / 1024).toFixed(2)} KB (총 ${stats.size / 4096}개 블록)`);
btree.close();
