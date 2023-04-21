// SPDX-License-Identifier: MIT
// https://tornado.cash
/*
 * d888888P                                           dP              a88888b.                   dP
 *    88                                              88             d8'   `88                   88
 *    88    .d8888b. 88d888b. 88d888b. .d8888b. .d888b88 .d8888b.    88        .d8888b. .d8888b. 88d888b.
 *    88    88'  `88 88'  `88 88'  `88 88'  `88 88'  `88 88'  `88    88        88'  `88 Y8ooooo. 88'  `88
 *    88    88.  .88 88       88    88 88.  .88 88.  .88 88.  .88 dP Y8.   .88 88.  .88       88 88    88
 *    dP    `88888P' dP       dP    dP `88888P8 `88888P8 `88888P' 88  Y88888P' `88888P8 `88888P' dP    dP
 * ooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo
 */

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import "./MerkleTreeWithHistory.sol";

/** @dev This contract(pool) allows deposit of an arbitrary amount to it, shielded transfer to another registered user inside the pool
 * and withdrawal from the pool. Project utilizes UTXO model to handle users' funds.
 */
contract TornadoPool is MerkleTreeWithHistory, ReentrancyGuard {
  IVerifier public immutable verifier;

  uint256 public lastBalance;
  mapping(bytes32 => bool) public nullifierHashes;

  struct ExtData {
    address recipient;
    int256 extAmount;
  }

  struct Proof {
    bytes proof;
    bytes32 root;
    bytes32[] inputNullifiers;
    bytes32[1] outputCommitments;
    uint256 publicAmount;
    bytes32 extDataHash;
  }

  event NewCommitment(bytes32 commitment, uint256 index);
  event NewNullifier(bytes32 nullifier);
  event NewMessage(bytes32 nullifier1, bytes32 nullifier2, bytes32 commitment, int256 extAmount, uint256 index);

  /**
    @dev The constructor
    @param _verifier the address of SNARK verifier for 2 inputs
    @param _levels hight of the commitments merkle tree
    @param _hasher hasher address for the merkle tree
  */
  constructor(
    IVerifier _verifier,
    uint32 _levels,
    address _hasher
  )
    MerkleTreeWithHistory(_levels, _hasher)
  {
    verifier = _verifier;
    // super._initialize();
  }

  function initialize() external initializer {
    // _configureLimits(_maximumDepositAmount);
    super._initialize();
  }

  /** @dev Main function that allows deposits, transfers and withdrawal.
   */
  function transact(Proof memory _args, ExtData memory _extData) public payable{
    if (_extData.extAmount > 0) {
      //  Deposit
      require(msg.value == uint256(_extData.extAmount), "amount is not equal to msg.value");
    }

    _transact(_args, _extData);
  }

  /** @dev whether a note is already spent */
  function isSpent(bytes32 _nullifierHash) public view returns (bool) {
    return nullifierHashes[_nullifierHash];
  }

  function verifyProof(Proof memory _args) public view returns (bool) {
    return
      verifier.verifyProof(
        _args.proof,
        [
          uint256(_args.root),
          _args.publicAmount,
          uint256(_args.extDataHash),
          uint256(_args.inputNullifiers[0]),
          uint256(_args.inputNullifiers[1]),
          uint256(_args.outputCommitments[0])
        ]
      );
  }

  function _transact(Proof memory _args, ExtData memory _extData) internal nonReentrant {
    require(isKnownRoot(_args.root), "Invalid merkle root");
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      require(!isSpent(_args.inputNullifiers[i]), "Input is already spent");
    }
    require(uint256(_args.extDataHash) == uint256(keccak256(abi.encode(_extData))) % FIELD_SIZE, "Incorrect external data hash");
    require(verifyProof(_args), "Invalid transaction proof");

    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      nullifierHashes[_args.inputNullifiers[i]] = true;
    }

    if (_extData.extAmount < 0) {
      require(_extData.recipient != address(0), "Can't withdraw to zero address");
      // send -_extData.extAmount amount of eth to _extData.recipient
      payable(_extData.recipient).transfer(uint256(-_extData.extAmount));
    }

    lastBalance = address(this).balance;
    _insert(_args.outputCommitments[0]);
    emit NewCommitment(_args.outputCommitments[0], nextIndex - 1);
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      emit NewNullifier(_args.inputNullifiers[i]);
    }
    NewMessage(_args.inputNullifiers[0], _args.inputNullifiers[1], _args.outputCommitments[0], _extData.extAmount, nextIndex - 1);
  }
}
