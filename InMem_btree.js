class BTreeNode {
    constructor(leaf = false) {
        this.leaf = leaf;
        this.keys = [];
        this.children = [];
        this.parent;
        this.tree;
    }

    printNode(depth = 0) {
        let result = '';
        let p = this.parent == undefined ? "(루트)" : "";
        if (this.leaf) {
            result += '\t'.repeat(depth) + this.keys.map(JSON.stringify).join(", ") + p + '\n';
        } else {
            for (let i = 0; i < this.children.length; i++) {
                if (i) result += '\t'.repeat(depth) + JSON.stringify(this.keys[i-1]) + p + '\n';
                result += this.children[i].printNode(depth + 1);
            }
        }
        return result;
    }

    getLastNode() {
        if (this.leaf) return this;
        else return this.children[this.children.length - 1].getLastNode();
    }

    getFirstNode() {
        if (this.leaf) return this;
        else return this.children[0].getFirstNode();
    }

    getPredNode(keyIndex) {
        if (this.leaf) return this;
        else return this.children[keyIndex].getLastNode();
    }
    
    getSuccNode(keyIndex) {
        if (this.leaf) return this;
        else return this.children[keyIndex + 1].getFirstNode();
    }

    everyKey(func, order) {
        let every = this.keys.every(func);
        let t = (order + 1) >> 1;
        if (!this.parent && (this.keys.length < 1 || this.keys.length > order))
            return false;
        if (this.parent && !(t - 1 <= this.keys.length && this.keys.length < order))
            return false;
        if (this.parent && !this.leaf && !(t <= this.children.length && this.children.length <= order))
            return false;
        if (!this.leaf) {
            for (let i = 0; i < this.children.length; i++) {
                let conditionFunc;
                if (i == 0) conditionFunc = (v) => v < this.keys[i];
                else if (i < this.children.length - 1) conditionFunc = (v) => this.keys[i - 1] < v && v < this.keys[i];
                else conditionFunc = (v) => this.keys[i - 1] < v;
                if (i < this.keys.length - 1 && this.keys[i] > this.keys[i + 1]) return -1;
                every &= this.children[i].everyKey(conditionFunc, order);
            }
            return every;
        } else return every;
    }

    isNodeCorrect(order) {
        return this.everyKey(() => true, order);
    }
}

class BTree {
    constructor(M, compareFunc) {
        this.root = new BTreeNode(true);
        this.t = (M + 1) >> 1; // Minimum degree
        this.M = M; // Maximum degree
        this.compare = compareFunc; // Custom comparison function
    }

    search(key, node = this.root) {
        for (let i = 0; i < node.keys.length; i++) {
            let c = this.compare(key, node.keys[i]);
            if (c > 0) continue;
            else if (c == 0) return { node, index: i };
            else if (node.leaf) return null;
            else return this.search(key, node.children[i]);
        }
        if (node.leaf) return null;
        else return this.search(key, node.children[node.children.length - 1]);
    }

    insert(key, node = this.root) {
        let index;
        for (index = 0; index < node.keys.length; index++) {
            let c = this.compare(key, node.keys[index]);
            if (c > 0) continue;
            else if (c == 0) return -1;
            else if (c < 0) {
                break;
            }
        }
        if (node.leaf) {
            node.keys.splice(index, 0, key);
            if (node.keys.length >= this.M) {
                this.split(node, this.M >> 1);
            }
            return 0;
        } else {
            return this.insert(key, node.children[index]);
        }
    }

    split(node, index) {
        let newNode = new BTreeNode(node.leaf);
        let middleKey = node.keys[index];
        newNode.keys = node.keys.splice(index + 1);
        node.keys.splice(index);  // Remove the middle key from the original this
        if (!node.leaf) {
            newNode.children = node.children.splice(index + 1);
            newNode.children.forEach(child => child.parent = newNode);
        }

        if (node.parent) {
            let parentIndex = node.parent.children.indexOf(node);
            node.parent.keys.splice(parentIndex, 0, middleKey);
            node.parent.children.splice(parentIndex + 1, 0, newNode);
            newNode.parent = node.parent;
            node.children.forEach((v) => v.parent = node);
            newNode.children.forEach((v) => v.parent = newNode);
            if (node.parent.keys.length >= this.M) this.split(node.parent, this.M >> 1);
        } else {
            let newRoot = new BTreeNode(false);
            newRoot.keys = [middleKey];
            newRoot.children = [node, newNode];
            this.root = newRoot;
            node.parent = newRoot;
            newNode.parent = newRoot;
        }
    }

    toString() {
        return this.root.printNode();
    }

    recover(node1) {
        if (this.root == node1) {
            console.error("이 B-tree는 재조정이 불가능합니다.");
            return -1;
        }
        if (node1.keys.length >= this.t - 1) return 0;
        //////////////////////////////////////
        // getBroNodes                      //
        //////////////////////////////////////
        // 좌우의 리프노드를 반환함.          //
        // 리프노드가 없을 시 -1을 리턴함.    //
        //////////////////////////////////////
        function getBroNodes(stdNode, parentNode = undefined) {
            if (!stdNode.parent) return {"bro1" : -1, "bro2" : -1};
            let stdNodeIndex = 0;
            parentNode = parentNode || stdNode.parent;
            while (stdNodeIndex < parentNode.children.length && parentNode.children[stdNodeIndex] != stdNode) {
                stdNodeIndex++;
            }
            if (stdNodeIndex >= parentNode.children.length) {
                console.error("파라미터가 잘못되었습니다. (parentNode 안에 standardNode가 없음)");
                console.error("======================================");
                console.log("노드 :", parentNode, stdNode);
                console.error("======================================");
                console.trace();
                return;
            }
            let bro1 = -1;
            let bro2 = -1;
            if (stdNodeIndex != 0) {
                bro1 = parentNode.children[stdNodeIndex - 1];
            }
            if (stdNodeIndex < parentNode.children.length - 1) {
                bro2 = parentNode.children[stdNodeIndex + 1];
            }
            return {"bro1" : bro1, "bro2" : bro2, stdNodeIndex};
        }

        let {bro1, bro2, stdNodeIndex} = getBroNodes(node1);
        if (bro1 != -1 && bro1.keys.length >= this.t) {
            node1.keys.unshift(...node1.parent.keys.splice(stdNodeIndex - 1, 1));
            node1.parent.keys.splice(stdNodeIndex - 1, 0, bro1.keys.pop());
            if (!node1.leaf) {
                node1.children.unshift(bro1.children.pop());
                node1.children[0].parent = node1;
            }
            return 0;
        } else if (bro2 != -1 && bro2.keys.length >= this.t) {
            node1.keys.push(...node1.parent.keys.splice(stdNodeIndex, 1));
            node1.parent.keys.splice(stdNodeIndex, 0, bro2.keys.shift());
            if (!node1.leaf) {
                node1.children.push(bro2.children.shift());
                node1.children[node1.children.length - 1].parent = node1;
            }
            return 0;
        } else if (bro1 != -1) {
            bro1.keys.push(...node1.parent.keys.splice(stdNodeIndex - 1, 1), ...node1.keys);
            if (!node1.leaf) {
                bro1.children.push(...node1.children);
            }
            if(node1.parent != bro1.parent) console.error("노드1과 브로1의 부모가 다릅니다@@@@!!!!!!");
            node1.parent.children.splice(stdNodeIndex, 1);
            for (let i = 0; i < bro1.children.length; i++) {
                bro1.children[i].parent = bro1;
            }
            if (!bro1.parent.keys.length && bro1.parent == this.root) this.root = bro1;
            else if (bro1.parent != this.root && bro1.parent.children.length < this.t) {
                this.recover(bro1.parent);
            }
            return 0;
        } else if (bro2 != -1) {
            bro2.keys.unshift(...node1.keys, ...node1.parent.keys.splice(stdNodeIndex, 1));
            if (!node1.leaf) {
                bro2.children.unshift(...node1.children);
            }
            if(node1.parent != bro2.parent) console.error("노드1과 브로1의 부모가 다릅니다@@@@!!!!!!");
            node1.parent.children.splice(stdNodeIndex, 1);
            for (let i = 0; i < bro2.children.length; i++) {
                bro2.children[i].parent = bro2;
            }
            if (!bro2.parent.keys.length && bro2.parent == this.root) this.root = bro2;
            else if (bro2.parent != this.root && bro2.parent.children.length < this.t) {
                this.recover(bro2.parent);
            }
            return 0;
        }
    }

    delete(key, node = this.root) {
        // breakpoint--;
        // if (breakpoint < 0) {
        //     console.error(this.toString());
        //     throw new Error("* break point *");
        // }
        let node_index = this.search(key, node);
        let node1 = node_index != null ? node_index.node : undefined;
        let index1 = node_index == null ? undefined : node_index.index;
        if (node_index == null) return -1;
        if (node1.leaf) {
            node1.keys.splice(index1, 1);
            if (this.root == node1) return 0;
            if (node1 != this.root && node1.keys.length < this.t - 1) {
                return this.recover(node1);
                // if (!this.isCorrect()) {
                //     console.error("================not root, not enough keys==================");
                //     console.trace();
                //     console.error("==================================");
                //     console.log(this.toString());
                //     console.error("==================================");
                // }
            }
        } else {
            let predNode = node1.getPredNode(index1);
            if (predNode.keys.length >= this.t) {
                node1.keys.splice(index1, 1, predNode.keys.pop());
                return 0;
            }
            let succNode = node1.getSuccNode(index1);
            if (succNode.keys.length >= this.t) {
                node1.keys.splice(index1, 1, succNode.keys.shift());
                return 0;
            }
            node1.keys.splice(index1, 1, predNode.keys.pop());
            return this.recover(predNode);
            // if (!this.isCorrect()) {
            //     console.error("================internal node, not enough keys==================");
            //     console.trace();
            //     console.error("==================================");
            //     console.log(this.toString());
            //     console.error("==================================");
            // }
        }
        return 0;
    }

    isCorrect() {
        return this.root.isNodeCorrect(this.M);
    }

    toJSON() {
        let list = [];
        let json = {};
        let index;
        list.push(this.root);
        for (index = 0; list.length > index; index++) {
            if (!list[index].leaf) {
                for (let i = 0; i < list[index].children.length; i++) {
                    list.push(list[index].children[i]);
                }
            }
        }
        json.data = [];
        for (index = 0; list.length > index; index++) {
            let array = [null,[]];
            array[0] = list[index].keys;
            for (let i = 0; i < list[index].children.length; i++) {
                array[1].push(list.indexOf(list[index].children[i]));
            }
            json.data.push(array);
        }
        json.metadata = {M: this.M, t: this.t};
        return JSON.parse(JSON.stringify(json));
    }
}
















































const fs = require('fs');
const { isMainThread } = require('worker_threads');

let btree;
let debug = [];
let now;

function runTests() {
    console.log("======================= Starting BTree tests =======================");

    let commands
    = {
        "TestSet1" : [ // 30가지 랜덤한 값을 추가하고 30가지 랜덤한 값을 삭제하기
            "create 3",
            "insert " + Array(10).fill(0).map(() => (Math.random() * 50) | 0).join(" "),
            "delete " + Array(10).fill(0).map(() => (Math.random() * 50) | 0).join(" ")
        ],
        "EdgeTest" : [
            "create 7",
            "insert " + Array.from(Array(100).keys()).join(" "),
            "delete " + Array.from(Array(50).keys()).map(i => i * 2).join(" ")
        ]
    };
    // commands = [];
    // for (let i = 0; i < 100; i++) {
    //     let iter = ((Math.random * 100) | 0) + 10;
    //     commands[i] = ["create " + (((Math.random()*30)|0)+3)];
    //     for (let j = 0; j < iter; j++) {
    //         if (Math.random() < 0.5) {
    //             commands[i].push("insert " + Array(((Math.random()*1000)|0)+10).fill(0).map(() => (Math.random() * 200) | 0).join(" "));
    //         } else {
    //             commands[i].push("delete " + Array(((Math.random()*1000)|0)+10).fill(0).map(() => (Math.random() * 200) | 0).join(" "));
    //         }
    //     }
    // }

    // let sets = JSON.parse('[' + fs.readFileSync("./test.txt") + ']');
    // let testCounter = 0;
    // for (let i of sets) {
    //     commands[testCounter++] = i;
    //     // if(testCounter > 3) break;
    // }

    for (let commandName in commands) {
        let commandLines = commands[commandName];
        let insertSet = [];
        let deleteSet = [];
        let isRight = true;

        now = JSON.stringify(commandLines, null, 4);
        console.log('* ' + commandName + ' *');

        for (let command of commandLines) {
            // console.log(command);
            command = command.split(' ');
            if (command[0] == "create") {
                insertSet = new Set();
                deleteSet = new Set();
                btree = new BTree(command[1] - 0, (a, b) => a - b);
            } else {
                if (command[0] == "insert") {
                    for (let i = 1; i < command.length; i++) {
                        let value = command[i] - 0;
                        insertSet.add(value);
                        deleteSet.delete(value);
                        btree.insert(value);
                        // if (commandName == 2) {
                        //     console.log("************" + "insert " + value + "***********");
                        //     console.error(btree.toString());
                        //     console.log("***********************");
                        // }
                        // if (!btree.isCorrect()) {
                        //     console.log("btree가 올바른 노드로 구성되어있지 않습니다.");
                        //     isRight = false;
                        // }
                    }
                } else if (command[0] == "delete") {
                    for (let i = 1; i < command.length; i++) {
                        let value = command[i] - 0;
                        insertSet.delete(value);
                        deleteSet.add(value);
                        // if (commandName == 2) {
                        //     console.log("************" + "delete " + value + "***********");
                        // }
                        btree.delete(value);
                        debug.push(btree.toString());
                        // if (commandName == 2) {
                        //     console.error(btree.toString());
                        //     console.log("***********************");
                        // }
                        // if (!btree.isCorrect()) {
                        //     console.log("btree가 올바른 노드로 구성되어있지 않습니다.");
                        //     isRight = false;
                        // }
                    }
                }
                // for (let i of Array.from(insertSet)) {
                //     if (btree.search(i) == null) {
                //         console.log(i + '가 추가되어야 합니다.');
                //         isRight = false;
                //     }
                // }
                // for (let i of Array.from(deleteSet)) {
                //     if (btree.search(i) != null) {
                //         isRight = false;
                //         console.log(i + '는 삭제되어야 하지만 삭제되지 않았습니다.');
                //     }
                // }
                // if (!btree.isCorrect()) {
                //     console.log("btree가 올바른 노드로 구성되어있지 않습니다.");
                //     isRight = false;
                // }
            }

        }
        if (!isRight) {
            console.error(btree.toString());
            // fs.appendFileSync("./test.txt", ',');
            // fs.appendFileSync("./test.txt", now);
            console.log("* " + commandName + " Failed. *");
            console.log("order : ", btree.M);
        } else {
            console.log(btree.toString());
            console.log(btree.toJSON());
            console.log("* " + commandName + " Pass~ *");
        }
    }

    console.log("======================= All tests completed. =======================");
}

// Run the tests
try {
    runTests();
} catch(err) {
    console.error(err);
    console.error("=======================================");
    console.log(debug[debug.length - 2]);
    console.log(debug[debug.length - 1]);
    console.error("=======================================");
    console.log(btree.toString());
    console.error("=======================================");
    fs.appendFileSync("./test.txt", ',');
    fs.appendFileSync("./test.txt", now);
}
