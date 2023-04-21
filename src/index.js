/* eslint-disable no-console */
const MerkleTree = require('fixed-merkle-tree')
const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { toFixedHex, poseidonHash, poseidonHash2, getExtDataHash, FIELD_SIZE, shuffle } = require('./utils')
const Utxo = require('./utxo')

const { prove } = require('./prover')
const MERKLE_TREE_HEIGHT = 5
const MAX_EXT_AMOUNT = BigNumber.from(2).pow(248)

async function buildMerkleTree({ tornadoPool }) {
  const filter = tornadoPool.filters.NewCommitment()
  const events = await tornadoPool.queryFilter(filter, 0)

  const leaves = events.sort((a, b) => a.args.index - b.args.index).map((e) => toFixedHex(e.args.commitment))
  // console.log(`Found ${leaves.length} commitments in the pool`)
  // console.log('LEAVES', leaves)
  return new MerkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })
}

function eventToMessageHash(event) {
  const { nullifier1, nullifier2, commitment, extAmount } = event.args
  // console.log(nullifier1, nullifier2, commitment, extAmount)
  return toFixedHex(poseidonHash([nullifier1, nullifier2, commitment, extAmount]))
}

async function buildMessageHashTree({ tornadoPool }) {
  const filter = tornadoPool.filters.NewMessage()
  const events = await tornadoPool.queryFilter(filter, 0)

  const leaves = events.sort((a, b) => a.args.index - b.args.index).map((e) => eventToMessageHash(e))
  // console.log(`Found ${leaves.length} messages in the pool`)
  // console.log(leaves)
  return new MerkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })
}

function buildAllowListTree({ allowList }) {
  const leaves = allowList.map((e) => toFixedHex(e))
  return new MerkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })
}
function buildAllowedCommitmentsTree(){
  return new MerkleTree(MERKLE_TREE_HEIGHT, [], { hashFunction: poseidonHash2 })
}

async function getProof({ inputs, outputs, tree, extAmount, recipient }) {
  inputs = shuffle(inputs)
  outputs = shuffle(outputs)

  let inputMerklePathIndices = []
  let inputMerklePathElements = []

  for (const input of inputs) {
    if (input.amount > 0) {
      input.index = tree.indexOf(toFixedHex(input.getCommitment()))
      if (input.index < 0) {
        throw new Error(`Input commitment ${toFixedHex(input.getCommitment())} was not found`)
      }
      inputMerklePathIndices.push(input.index)
      inputMerklePathElements.push(tree.path(input.index).pathElements)
    } else {
      inputMerklePathIndices.push(0)
      inputMerklePathElements.push(new Array(tree.levels).fill(0))
    }
  }

  const extData = {
    recipient: toFixedHex(recipient, 20),
    extAmount: toFixedHex(extAmount),
  }

  const extDataHash = getExtDataHash(extData)
  let input = {
    root: tree.root(),
    inputNullifier: inputs.map((x) => x.getNullifier()),
    outputCommitment: outputs.map((x) => x.getCommitment()),
    publicAmount: BigNumber.from(extAmount).mod(FIELD_SIZE).toString(),
    extDataHash,

    // data for 2 transaction inputs
    inAmount: inputs.map((x) => x.amount),
    inBlinding: inputs.map((x) => x.blinding),
    inPathIndices: inputMerklePathIndices,
    inPathElements: inputMerklePathElements,

    // data for 2 transaction outputs
    outAmount: outputs.map((x) => x.amount),
    outBlinding: outputs.map((x) => x.blinding),
  }

  const proof = await prove(input, `./artifacts/circuits/transaction${inputs.length}`)

  const args = {
    proof,
    root: toFixedHex(input.root),
    inputNullifiers: inputs.map((x) => toFixedHex(x.getNullifier())),
    outputCommitments: outputs.map((x) => toFixedHex(x.getCommitment())),
    publicAmount: toFixedHex(input.publicAmount),
    extDataHash: toFixedHex(extDataHash),
  }
  // console.log('Solidity args', args)

  return {
    extData,
    args,
    proofInputs: input,
  }
}

async function prepareTransaction({ tornadoPool, inputs = [], outputs = [], recipient = 0 }) {
  if (inputs.length > 16 || outputs.length > 2) {
    throw new Error('Incorrect inputs/outputs count')
  }
  while (inputs.length !== 2 && inputs.length < 16) {
    inputs.push(new Utxo())
  }
  while (outputs.length < 1) {
    outputs.push(new Utxo())
  }
  if (outputs.length > 1) {
    throw new Error('Incorrect outputs count')
  }

  let extAmount = BigNumber.from(0)
    .add(outputs.reduce((sum, x) => sum.add(x.amount), BigNumber.from(0)))
    .sub(inputs.reduce((sum, x) => sum.add(x.amount), BigNumber.from(0)))

  const proofData = {
    inputs,
    outputs,
    tree: await buildMerkleTree({ tornadoPool }),
    extAmount,
    recipient,
  }

  // console.log(JSON.stringify({
  //   inputs,
  //   outputs,
  //   extAmount,
  //   recipient,
  // }, null, 2))

  const { args, extData, proofInputs } = await getProof(proofData)

  return {
    args,
    extData,
    extAmount,
    proofInputs
  }
}

async function transaction({ tornadoPool, ...rest }) {
  const { args, extData, extAmount, proofInputs } = await prepareTransaction({
    tornadoPool,
    ...rest,
  })
  // if extAmount is bigger than 0, then we need to add this amount to the recipient balance
  // if extAmount is less than 0, then we need to add this amount to the sender balance
  // if extAmount is 0, then we don't need to do anything
  // console.log('extAmount', extAmount.toString())
  // console.log('extData', extData)
  // console.log('args', args)
  let receipt
  if (extAmount.gt(0)) {
    receipt = await tornadoPool.transact(args, extData, {
      gasLimit: 2e6,
      value: extAmount,
    })
  } else {
    receipt = await tornadoPool.transact(args, extData, {
      gasLimit: 2e6,
    })
  }
  return {
    receipt: await receipt.wait(),
    args,
    proofInputs
  }
}

function getMessageHash({ inputNullifiers, outputCommitments, publicAmount }) {
  // console.log(inputNullifiers, outputCommitments, publicAmount)
  // convert string to big number
  publicAmount = BigNumber.from(publicAmount)
  // make it a big number array making inputs, outputs and publicAmount
  // all the same length
  const inputs = inputNullifiers.map((x) => BigNumber.from(x))
  const outputs = outputCommitments.map((x) => BigNumber.from(x))
  const publicAmounts = new Array(1).fill(publicAmount)

  const message = inputs.concat(outputs).concat(publicAmounts)
  // console.log(message)
  const messageHash = poseidonHash(message)
  return toFixedHex(messageHash)
}

function generateProofInputs({messageHashTree, allowListTree, allowedCommitmentsTree, transaction, isLast}){
  let input = {
    step_in : null,
    messageHashPathIndices : null,
    messageHashPathElements : [],
    allowedMessageHashPathIndices : null,
    allowedMessageHashPathElements : [],
    inAmount : null,
    inBlinding : null,
    outCommitments : null,
    amount : null,
    allowedPathIndices : null,
    allowedPathElements : null,
    outputMessageHash : null,
    updatePathElements : null,
    updatePathIndices : null,
    allowedCommitmentsNewRoot: null
  }
  const {proofInputs, args} = transaction
  const messageHash = getMessageHash(args)
  console.log(messageHash)
  console.log(messageHashTree.elements())
  console.log("proofInputs", proofInputs)
  console.log("args", args)
  input.step_in = [allowedCommitmentsTree.root(), messageHashTree.root(), allowListTree.root(), 0]

  let publicAmount = BigNumber.from(args.publicAmount)
  publicAmount = publicAmount.gt(MAX_EXT_AMOUNT) ? FIELD_SIZE.sub(publicAmount).mul(BigNumber.from(-1)) : publicAmount

  const index = messageHashTree.indexOf(messageHash)
  if (index == -1) {
    throw new Error('messageHash not in messageHashTree')
  }
  input.messageHashPathIndices = index
  input.messageHashPathElements = messageHashTree.path(index).pathElements
  console.log(isLast, publicAmount)

  if (publicAmount.gt(0)) {
    // we need to prove messageHash is in allowList
    const index = allowListTree.indexOf(messageHash)
    if (index == -1) {
      throw new Error('messageHash not in allowList')
    }
    input.allowedMessageHashPathIndices = (index)
    input.allowedMessageHashPathElements = (allowListTree.path(index).pathElements)
  } else {
    input.allowedMessageHashPathIndices = (0)
    input.allowedMessageHashPathElements = (new Array(allowListTree.levels).fill(0))
  }
  console.log(proofInputs)
  input.inAmount = proofInputs.inAmount
  input.inBlinding = proofInputs.inBlinding
  input.outCommitments = proofInputs.outCommitments
  input.amount = proofInputs.publicAmount
  input.outCommitments = [proofInputs.outputCommitment[0]]
  // for every nullifier add merkle proofs to allowedPathIndices
  // and allowedPathElements
  input.allowedPathIndices = []
  input.allowedPathElements = []
  for(let j = 0; j < proofInputs.inputNullifier.length; j++) {
    const amount = proofInputs.inAmount[j]
    const blinding = proofInputs.inBlinding[j]
    const utxo = new Utxo({amount,  blinding})
    // console.log(amount, blinding)
    if(amount > 0) {
      // console.log(toFixedHex(utxo.getCommitment()))
      // console.log(allowedCommitmentsTree.elements())
      const index = allowedCommitmentsTree.indexOf(toFixedHex(utxo.getCommitment()))
      if(index == -1) {
        throw new Error('utxo not in allowedCommitmentsTree')
      }
      input.allowedPathIndices.push(index)
      input.allowedPathElements.push(allowedCommitmentsTree.path(index).pathElements)
    } else {
      input.allowedPathIndices.push(0)
      input.allowedPathElements.push(new Array(MERKLE_TREE_HEIGHT).fill(0))
    }
  }
  input.outputMessageHash = isLast ? messageHash : 0

  // if(!isLast){
    allowedCommitmentsTree.insert(args.outputCommitments[0])
    const newCommitmentindex = allowedCommitmentsTree.indexOf(args.outputCommitments[0])
    input.updatePathIndices = (newCommitmentindex)
    input.updatePathElements = (allowedCommitmentsTree.path(newCommitmentindex).pathElements)
  // } else {
  //   input.updatePathIndices = (0)
  //   input.updatePathElements = (new Array(MERKLE_TREE_HEIGHT).fill(0))
  // }
  input.allowedCommitmentsNewRoot = isLast ? 0 : allowedCommitmentsTree.root()


  // input.step_out = [allowedCommitmentsTree.root(), messageHashTree.root(), allowListTree.root(), isLast ? messageHash : 0]

  return {
    input, allowedCommitmentsTree
  }

}

async function generateProofOfInnocence({ tornadoPool, allowList, outputMessageHash, transactions }) {
  const messageHashTree = await buildMessageHashTree({ tornadoPool })
  const allowListTree = buildAllowListTree({ allowList })
  let allowedCommitmentsTree = buildAllowedCommitmentsTree()

  poiInputs = []
  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i]
    let response = generateProofInputs({messageHashTree, allowListTree, allowedCommitmentsTree, transaction, isLast: i == transactions.length - 1});
    const input = response.input
    allowedCommitmentsTree = response.allowedCommitmentsTree
    // console.log("INPUTINPUTINPUT", input)
    // convert input to decimals

    const inputDecimals = Object.keys(input).reduce((acc, key) => {
      if (Array.isArray(input[key])) {
        // if input[key] is an array, map it to hex

        acc[key] = input[key].map((x) => Array.isArray(x) ? x.map(toFixedHex) : toFixedHex(x))
      } else {
        acc[key] = toFixedHex(input[key])
      }
      return acc
    }, {})
    poiInputs.push(JSON.stringify(inputDecimals))
    console.log(JSON.stringify(inputDecimals))
    console.log(input)
    console.log("Transaction", i, "of", transactions.length)
    // input.step_in[1] = input.step_in[1].add(1)
    const proof = await prove(input, `./artifacts/circuits/proofOfInnocence`)
    console.log(proof)
    // return;
  }
  console.log(poiInputs)
}

module.exports = {
  transaction,
  prepareTransaction,
  buildMerkleTree,
  getMessageHash,
  generateProofOfInnocence,
}
