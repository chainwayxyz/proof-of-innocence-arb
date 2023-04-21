const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction,getMessageHash, prepareTransaction, buildMerkleTree, generateProofOfInnocence } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')
const config = require('../config')
const { generate } = require('../src/0_generateAddresses')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('TornadoPool', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    // const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')
    // console.log('hasher', hasher.address)


    /** @type {TornadoPool} */
    const tornadoPool = await deploy(
      'TornadoPool',
      verifier2.address,
      // verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
    )
    const  data = await tornadoPool.initialize()
    // console.log('data', data)


    return { tornadoPool }
  }

  it('should find current root', async function () {
    let { tornadoPool } = await loadFixture(fixture)
    const sender = (await ethers.getSigners())[0]
    
    // getLastRoot()
    const lastRoot = await tornadoPool.getLastRoot()
    // console.log('lastRoot', lastRoot)
    expect(lastRoot).to.equal('0x1d24c91f8d40f1c2591edec19d392905cf5eb01eada48d71836177ef11aea5b2')
  })

  xit('should register and deposit', async function () {
    let { tornadoPool } = await loadFixture(fixture)
    const sender = (await ethers.getSigners())[0]

    // Alice deposits into tornado pool
    const aliceDepositAmount = 1e7
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })

    tornadoPool = tornadoPool.connect(sender)
    await transaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    })

    const commitmentFilter = tornadoPool.filters.NewCommitment()
    const nullifierFilter = tornadoPool.filters.NewNullifier()
    const fromBlock = await ethers.provider.getBlock()
    const commitmentEvents = await tornadoPool.queryFilter(commitmentFilter, fromBlock.number)
    const nullifierEvents = await tornadoPool.queryFilter(nullifierFilter, fromBlock.number)
    // console.log('events', events)
    console.log('NEW COMMITMENT', commitmentEvents[0].args.commitment)
    console.log('NEW COMMITMENT', commitmentEvents[1].args.commitment)

    console.log('NEW NULLIFIER', nullifierEvents[0].args.nullifier)
    console.log('NEW NULLIFIER', nullifierEvents[1].args.nullifier)
  })

  it('should deposit twice, withdraw once', async function () {
    const { tornadoPool } = await loadFixture(fixture)

    // Alice deposits into tornado pool
    const aliceDepositAmount = utils.parseEther('1')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount })
    const {receipt: receipt1, args: args1, proofInputs:proofInputs1} = await transaction({ tornadoPool, outputs: [aliceDepositUtxo] })

    const aliceDepositAmount2 = utils.parseEther('1')
    const aliceDepositUtxo2 = new Utxo({ amount: aliceDepositAmount2 })
    const {receipt: receipt2, args: args2, proofInputs:proofInputs2} = await transaction({ tornadoPool, outputs: [aliceDepositUtxo2] })

    // Alice withdraws from tornado pool
    const aliceWithdrawRemaining = utils.parseEther('0.5')
    const aliceWithdrawReaminingUtxo = new Utxo({ amount: aliceWithdrawRemaining, })

    const {receipt: receipt3, args: args3, proofInputs: proofInputs3} = await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo, aliceDepositUtxo2],
      outputs: [aliceWithdrawReaminingUtxo],
      recipient: '0xbd81B82C00ab5abADC9D33097EbEda5f5773D3A5'
    })

    // get the balance of the recipient
    const recipientBalance = await ethers.provider.getBalance('0xbd81B82C00ab5abADC9D33097EbEda5f5773D3A5')
    // console.log('recipientBalance', recipientBalance.toString())
    expect(recipientBalance.toString()).to.be.equal('1500000000000000000')


    // console.log(args1);
    // console.log(args2);
    // console.log(args3);

    // console.log(getMessageHash(args1));


    const allowList = [getMessageHash(args1), getMessageHash(args2)]
    const outputMessageHash = getMessageHash(args3)
    const transactions = [
      {
        proofInputs: proofInputs1,
        args: args1
      }, 
      {
        proofInputs: proofInputs2,
        args: args2
      },
      {
        proofInputs: proofInputs3,
        args: args3
      }
    ]


    await generateProofOfInnocence({tornadoPool, allowList, outputMessageHash, transactions})


  })
})
