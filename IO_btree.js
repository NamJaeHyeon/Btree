'use strict';

const path = require("path");
const fs = require("fs");
const fs_p = fs.promises;

function ensureDir(dirPath) {
    return new Promise((resolve, reject) => {
        fs.mkdir(dirPath, { recursive: true }, (err) => {
            if (err) {
            if (err.code === 'EEXIST') {
                // 디렉토리가 이미 존재하는 경우
                resolve();
            } else {
                // 다른 에러 발생 시
                reject(err);
            }
            } else {
            // 디렉토리 생성 성공
            resolve();
            }
        });
    });
}

function readJSON(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJSON(filePath, obj) {
    return fs.writeFileSync(filePath, JSON.stringify(obj), 'utf-8');
}

class BTreeNode {
    static btreeInfo = {};
    /* usedNodeToSave = []; usedNodeToSave usedNodeIndexToSave deletedIndex
    static usedNodeIndexToSave = [];
    static deletedIndex = [];
    */

    constructor(btree, nodeIndex, isLeaf, children, keys) {
        this.btree = btree;
        this.nodeIndex = nodeIndex;
        this.children = children || [];
        this.keys = keys || [];
        this.isLeaf = isLeaf;
    }

    static async get(btree, nodeIndex) {
        if (nodeIndex < 0 || nodeIndex >= btree.numberOfNode) {
            throw new Error("삐빅-- " + nodeIndex + ' | ' + btree.numberOfNode);
        }
        const btreeID = btree.tableName + '_' + btree.columnName + '_' + btree.compareName;
        if (!(btreeID in BTreeNode.btreeInfo)) {
            BTreeNode.btreeInfo[btreeID] = {
                usedNodeToSave: {},
                deletedIndex: []
            };
        }
        if (nodeIndex in BTreeNode.btreeInfo[btreeID].usedNodeToSave) {
            return BTreeNode.btreeInfo[btreeID].usedNodeToSave[nodeIndex];
        }
        let readBuffer = Buffer.alloc(4096);
        await btree.fileHandle.read(readBuffer, 0, 4096, nodeIndex << 12);
        const signBit = -2147483648;

        let children = Array.from(new Int32Array(readBuffer.buffer, readBuffer.byteOffset, readBuffer.length / 4));
        let order = children[1023] & ~signBit;
        let isLeaf = (order & signBit) == signBit;

        let keys = children.splice(512);
        children.splice(order);
        keys.splice(order - 1);

        readBuffer = null;

        return new BTreeNode(btree, nodeIndex, isLeaf, children, keys);
    }
    
    static create(btree, isLeaf) {
        let nodeIndex;
        const btreeID = btree.tableName + '_' + btree.columnName + '_' + btree.compareName;
        if (!(btreeID in BTreeNode.btreeInfo)) {
            BTreeNode.btreeInfo[btreeID] = {
                usedNodeToSave: {},
                deletedIndex: []
            };
        }
        if (BTreeNode.btreeInfo[btreeID].deletedIndex.length) {
            nodeIndex = BTreeNode.btreeInfo[btreeID].deletedIndex[0];
            BTreeNode.btreeInfo[btreeID].deletedIndex.shift();
        } else {
            nodeIndex = btree.numberOfNode++;
        }
        
        return new BTreeNode(btree, nodeIndex, isLeaf, [], []);
    }

    async getLastNode() {
        if (this.isLeaf) return this;
        else return await BTreeNode.get(this.btree, this.children[this.children.length - 1]).getLastNode();
    }
    
    async getFirstNode() {
        if (this.isLeaf) return this;
        else return await BTreeNode.get(this.btree, this.children[0]).getFirstNode();
    }

    async getPredNode(keyIndex) {
        if (this.isLeaf) return this;
        else return await BTreeNode.get(this.btree, this.children[keyIndex]).getLastNode();
    }

    async getSuccNode(keyIndex) {
        if (this.isLeaf) return this;
        else return await BTreeNode.get(this.btree, this.children[keyIndex + 1]).getFirstNode();
    }

    goingToSave() {
        const btreeID = this.btree.tableName + '_' + this.btree.columnName + '_' + this.btree.compareName;
        if (!(btreeID in BTreeNode.btreeInfo)) {
            BTreeNode.btreeInfo[btreeID] = {
                usedNodeToSave: {},
                deletedIndex: []
            };
        }
        if (!(this.nodeIndex in BTreeNode.btreeInfo[btreeID].usedNodeToSave)) {
            BTreeNode.btreeInfo[btreeID].usedNodeToSave[this.nodeIndex] = this;
        }
        return 0;
    }

    sync() {
        try {
            const signBit = -2147483648;
            const childrenBuffer = Buffer.from(new Int32Array(this.children));
            const keysBuffer = Buffer.from(new Int32Array(this.keys));
            const tempBuffer = Buffer.from((new Int32Array([(this.isLeaf ? signBit : 0) | (this.keys.length + 1)])).buffer);
            this.btree.fileHandle.write(childrenBuffer, 0, childrenBuffer.byteLength, this.nodeIndex << 12);
            this.btree.fileHandle.write(keysBuffer, 0, keysBuffer.byteLength, 2048 + (this.nodeIndex << 12));
            this.btree.fileHandle.write(tempBuffer, 0, 4, 4092 + (this.nodeIndex << 12));
            return 0;
        } catch (err) {
            console.error(err);
            return -1;
        }
    }

    static SyncAllNode() {
        for (let btreeID in BTreeNode.btreeInfo) {
            if (!(btreeID in BTreeNode.btreeInfo)) return 0;
            for (let i in BTreeNode.btreeInfo[btreeID].usedNodeToSave) {
                if(!BTreeNode.btreeInfo[btreeID].deletedIndex.includes(i)) BTreeNode.btreeInfo[btreeID].usedNodeToSave[i].sync();
            }
            BTreeNode.btreeInfo[btreeID].usedNodeToSave = {};
        }
        return 0;
    }

    async toString(depth = 0) {
        let result, i, isLeaf;
        isLeaf = this.isLeaf;
        
        for (i = 0; i < this.keys.length; i++) {
            if(!isLeaf) result += await (await BTreeNode.get(this.children(i))).toString() + '\n';
            result += '\t'.repeat(depth) + this.keys[i] + isLeaf ? " " : "\n";
        }
        if(!isLeaf) result += await (await BTreeNode.get(this.children(i))).toString() + '\n';

        return result;
    }

    deleteNode() {
        const btreeID = this.btree.tableName + '_' + this.btree.columnName + '_' + this.btree.compareName;
        if (!(btreeID in BTreeNode.btreeInfo)) {
            BTreeNode.btreeInfo[btreeID] = {
                usedNodeToSave: {},
                deletedIndex: []
            };
        }
        if (!(this.nodeIndex in BTreeNode.btreeInfo[btreeID])) {
            delete BTreeNode.btreeInfo[btreeID].usedNodeToSave[this.nodeIndex];
        }
        if (!BTreeNode.btreeInfo[btreeID].deletedIndex.includes(this.nodeIndex)) BTreeNode.btreeInfo[btreeID].deletedIndex.push(this.nodeIndex);
        Object.keys(this).forEach(key => {
            this[key] = null;
        });
        return 0;
    }
}

class BTree {
    constructor() {
        this.M = 512;
        this.numberOfNode = 0;
        this.tableName;
        this.columnName;
        this.compareName;
        this.compareFunc;
        this.fileHandle;
        this.root;
        this.deletedNodeIndex;
    }

    static async get(tableName, columnName, compareName) {
        try {
            const btree = new BTree();
            const dirPath = path.join(__dirname, "DB", tableName);
            const btreePath = path.join(dirPath, columnName + '_' + compareName + ".btree");
            const jsonPath = path.join(dirPath, columnName + "_manifest.json");
            let json = readJSON(jsonPath);
            let info = json[compareName];

            btree.numberOfNode = info.numberOfNode;
            btree.tableName = tableName;
            btree.columnName = columnName;
            btree.compareName = compareName;
            btree.compareFunc = eval(info.compareFunc);
            btree.fileHandle = await fs_p.open(btreePath, "w+");
            btree.root = info.rootNodeIndex && await BTreeNode.get(btree, info.rootNodeIndex);
            btree.deletedNodeIndex = info.deletedNodeIndex;
            return btree;
        } catch (err) {
            console.error("에러 뾰로롱~");
            console.error(err);
            return undefined;
        }
    }

    static async create(tableName, columnName, compareName, compareFunc = undefined) {
        try {
            const dirPath = path.join(__dirname, "DB", tableName);
            const filePath = path.join(dirPath, columnName + '_' + compareName + ".btree");
            const btree = new BTree();
            const manifestPath = path.join(dirPath, columnName + "_manifest.json");
            let json;
            ensureDir(dirPath);

            try {
                json = readJSON(manifestPath);
            } catch (err) {
                if (err.code == "ENOENT") {
                    console.log("파일이 없습니다. 파일을 새로 생성합니다.")
                    writeJSON(manifestPath, {});
                    json = readJSON(manifestPath);
                } else {
                    throw err;
                }
            }

            btree.columnName = columnName;
            if (compareFunc)
                json[compareName] = {"numberOfNode": 0, "compareFunc": compareFunc.toString()};
            else if (!(compareName in json))
                throw new Error("json 내에 compareName에 해당하는 compareFunc가 없음");
            else throw new Error("compareFunc를 잘 입력해주세요.");
            writeJSON(path.join(dirPath, columnName + "_manifest.json"), json);
            btree.tableName = tableName;
            btree.compareName = compareName;
            btree.compareFunc = compareFunc;
            btree.fileHandle = await fs_p.open(filePath, "w+");
            btree.root = undefined;
            btree.deletedNodeIndex = [];
            return btree;
        } catch(err) {
            console.error(err);
            console.error("오잉???");
            console.trace();
        }
    }
    
    async search(key, node = this.root, parent = []) {
        let left = 0;
        let right = node.keys.length;
        let mid, condition;
        while (left <= right) {
            mid = (left + right) >> 1;
            condition = this.compareFunc(key, node.keys[mid]);
            if (condition > 0) left = mid + 1;
            else if (condition == 0) return {node, keyIndex: mid, parent};
            else right = mid - 1;
        }
        if (node.isLeaf()) return -1;
        else return await this.search(key, await BTreeNode.get(node.children(left)), [node, left]);
    }

    async searchParentNode(nodeToFind) {
        if (nodeToFind == this.root) return -1;
        let x = await this.search(nodeToFind.keys[0]);
        return x.parent;
    }

    async split(node, index) {
        const newNode = BTreeNode.create(this, node.isLeaf);
        const middleKey = node.keys[index];
        newNode.keys = node.keys.splice(index + 1);
        node.keys.splice(index);
        node.goingToSave();
        newNode.goingToSave();
        if (!node.leaf) {
            newNode.children = node.children.splice(index + 1);
        }
        if (node == this.root) {
            const newRoot = BTreeNode.create(this, false);
            newRoot.keys = [middleKey];
            newRoot.children = [node.nodeIndex, newNode.nodeIndex];
            this.root = newRoot;
            newRoot.goingToSave();
        } else {
            const parent = this.searchParentNode(node);
            const [ parentNode, index ] = parent;
            parentNode.keys.splice(index, 0, middleKey);
            parentNode.children.splice(index + 1, 0, newNode);
            if (order > this.M) {
                this.split(parentNode, this.M >> 1);
            }
            parentNode.goingToSave();
        }
        return 0;
    }

    async insert(key, node = this.root) {
        let left = 0;
        let right;
        let mid, condition;
        if (this.root == undefined) {
            this.root = BTreeNode.create(this, true);
            this.root.keys = [key];
            this.root.goingToSave();
            return 0;
        }
        right = node.keys.length - 1;
        while (left <= right) {
            mid = (left + right) >> 1;
            condition = await this.compareFunc(key, node.keys[mid]);
            if (condition > 0) left = mid + 1;
            else if (condition == 0) return -1;
            else right = mid - 1;
        }
        if (node.isLeaf) {
            node.keys.splice(left, 0, key);
            if (node.keys.length >= this.M) {
                await this.split(node, this.M >> 1);
            }
        }
        else await this.insert(key, await BTreeNode.get(this, node.children[left]));
        return BTreeNode.SyncAllNode();
    }

    async recover(node) {
        if (this.root == node) {
            console.error("이 B-tree는 재조정이 불가능합니다.");
            return -1;
        }
        if (node.keys.length >= ((this.M + 1) >> 1) - 1) return 0;

        const [ parentNode, parentIndex ] = await this.searchParentNode(node);
        let parentOrder = parentNode.keys.length + 1;
        let bro1, bro2, bro1Order, bro2Order;
        if (parentOrder != 0) {
            bro1 = await BTreeNode.get(parentNode.children[parentIndex - 1]);
            bro1Order = bro1.keys.length + 1;
        }
        if (parentOrder != parentIndex) {
            bro2 = await BTreeNode.get(parentNode.children[parentIndex + 1]);
            bro2Order = bro2.keys.length + 1;
        }

        if ((parentOrder != 0) && bro1Order > ((this.M + 1) >> 1)) {
            node.keys.unshift(...parentNode.keys.splice(parentIndex - 1, 1));
            parentNode.keys.splice(parentIndex - 1, 0, bro1.keys.pop());
            if (!node.isLeaf) {
                node.children.unshift(bro1.children.pop());
            }
            node.goingToSave();
            bro1.goingToSave();
            parentNode.goingToSave();
        } else if (parentOrder != parentIndex && bro2Order > ((this.M + 1) >> 1)) {
            node.keys.push(...parentNode.keys.splice(parentNode, 1));
            parentNode.keys.splice(parentIndex, 0, bro2.keys.shift());
            if (!node.isLeaf) {
                node.children.push(bro2.children.shift());
            }
            node.goingToSave();
            bro2.goingToSave();
            parentNode.goingToSave();
        } else if (parentIndex != 0) {
            bro1.keys.push(...parentNode.keys.splice(parentIndex - 1, 1), ...node.keys);
            if (node.isLeaf) bro1.children.push(...node.children);
            if (!parentNode.keys.length && parentNode == this.root) this.root = bro1.nodeIndex;
            else if (parentNode != this.root && parentNode.children.length < ((this.M + 1) >> 1))
                await this.recover(parentNode);
            node.deleteNode();
            bro1.goingToSave();
            parentNode.goingToSave();
        } else if (parentOrder != parentIndex) {
            bro2.keys.unshift(...node.keys, ...parentNode.keys.splice(parentIndex, 1));
            if (!node.isLeaf) bro2.children.unshift(...node.children);
            parentNode.children.splice(parentIndex, 1);
            if (!parentNode.keys.length && parentNode == this.root) this.root = bro2;
            else if (parentNode != this.root && parentNode.children.length < ((this.M + 1) >> 1))
                await this.recover(parentNode);
            node.deleteNode();
            bro2.goingToSave();
            parentNode.goingToSave();
        }
        return 0;
    }

    async delete(key, node_ = this.root) {
        const ni = this.search(key, node_);
        const node = ni == null ? undefined : ni.node;
        const index = ni == null ? undefined : ni.keyIndex;
        if (ni == null) return -1;
        if (node.isLeaf) {
            node.keys.splice(index, 1);
            if (this.root == node) return 0;
            if (node != this.root && node.keys.length < ((this.M + 1) >> 1)) {
                return await this.recover(node);
            }
            return 0;
        } else {
            let predNode = node.getPredNode(index);
            if (predNode.keys.length >= ((this.M + 1) >> 1)) {
                node.keys.splice(index, 1, predNode.keys.pop());
                return 0;
            }
            let succNode = node.getSuccNode(index);
            if (succNode.keys.length >= ((this.M + 1) >> 1)) {
                node.keys.splice(index, 1, succNode.keys.shift());
                return 0;
            }
            node.keys.splice(index, 1, predNode.keys.pop());
            return await this.recover(predNode);
        }
    }

    async toString() {
        return await this.root.toString();
    }

    async save() {
        await this.fileHandle.sync();
        const dirPath = path.join(__dirname, "DB", this.tableName);
        const jsonPath = path.join(dirPath, this.columnName + "_manifest.json");
        let json = readJSON(jsonPath);
        json[this.compareName].numberOfNode = this.numberOfNode;
        json[this.compareName].rootNodeIndex = this.root.nodeIndex;
        writeJSON(jsonPath, json);
        return 0;
    }

    async close() {
        await this.save();
        await this.fileHandle.close();
    }
}






























async function main() {
    let btree = undefined; //await BTree.get("talking", "id", "default");
    let toInsert = Array.from(Array(10000).keys()).sort((a,b) => ((Math.random()*2)|0)*2-1);
    
    if (!btree) {
        console.log("btree가 반환되지 않았습니다.");
        try {
            fs.rmSync(path.join(__dirname, "DB", "talking", "id_default.btree"));
        } catch {
            console.log("삭제할 파일이 없습니다.");
        }
        try {
            fs.rmSync(path.join(__dirname, "DB", "talking", "id_manifest.json"));
        } catch {
            console.log("삭제할 파일이 없습니다.");
        }
        btree = await BTree.create("talking", "id", "default", (a, b) => a - b);
    }
    for (let i of toInsert) {
            try {

                let x;
                if (Math.random() < 1) {
                    console.log("try to insert :", i);
                    x = await btree.insert(i);
                    if (x == 0) console.log("Success to insert :", i);
                    else console.log("Failed(" + x + ") to insert :", i);
                }
                if (x != 0) {
                    console.log("Failed(" + x + ") to insert :", i);
                    throw new Error("에러 발생");
                }
                
            } catch (err) {
                console.error("에러 발생 ===================");
                console.error(err);
                console.log(btree.root);
                await btree.close();
                process.exit(0);
            }
        }
        
        console.log(await btree.toString());

        await btree.save();
}

main();
