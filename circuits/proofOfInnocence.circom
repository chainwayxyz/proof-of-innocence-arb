include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/switcher.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "./merkleProof.circom";

/*
Utxo structure:
{
    amount,
    blinding, // random number
}

commitment = hash(amount, blinding)
nullifier = hash(blinding)
*/

// AllowedCommitments: is a list of allowed commitments
// MessageHashesRoot: is a merkle root of all message hashes
// AllowedMessageHashes: is a list of allowed message hashes
// output MessageHash

// Universal JoinSplit transaction with nIns inputs and 2 outputs
template Step(levels, nIns, nOuts, zeroLeaf) {
    signal input step_in[4];
    signal output step_out[4];


    signal private input messageHashPathIndices;
    signal private input messageHashPathElements[levels];

    signal private input allowedMessageHashPathIndices;
    signal private input allowedMessageHashPathElements[levels];

    signal private input inAmount[nIns];
    signal private input inBlinding[nIns];

    signal private input outCommitments[nOuts];

    signal private input amount;

    signal private input allowedPathIndices[nIns];
    signal private input allowedPathElements[nIns][levels];

    signal private input outputMessageHash;

    signal private input updatePathElements[levels];
    signal private input updatePathIndices;

    signal private input allowedCommitmentsNewRoot;

    component inCommitmentHasher[nIns];
    component inTree[nIns];
    component inCheckRoot[nIns];
    component messageHashTree;
    component allowedMessageHashTree;
    component messageHasher;
    // component messageHashCheckRoot;
    component AllowedMessageHashCheckRoot;
    component inNullifierHasher[nIns];
    component checkOutputMessageHash;
    component treeBefore;
    component treeAfter;
    component checkUpdatePath;
    component amountComparator;

    messageHasher =  Poseidon(nIns + nOuts + 1);
    // verify correctness of transaction inputs
    for (var tx = 0; tx < nIns; tx++) {

        inCommitmentHasher[tx] = Poseidon(2);
        inCommitmentHasher[tx].inputs[0] <== inAmount[tx];
        inCommitmentHasher[tx].inputs[1] <== inBlinding[tx];

        inNullifierHasher[tx] = Poseidon(1);
        inNullifierHasher[tx].inputs[0] <== inBlinding[tx];
        messageHasher.inputs[tx] <== inNullifierHasher[tx].out;


        inTree[tx] = MerkleProof(levels);
        inTree[tx].leaf <== inCommitmentHasher[tx].out;
        inTree[tx].pathIndices <== allowedPathIndices[tx];
        for (var i = 0; i < levels; i++) {
            inTree[tx].pathElements[i] <== allowedPathElements[tx][i];
        }

        // check merkle proof only if amount is non-zero
        inCheckRoot[tx] = ForceEqualIfEnabled();
        inCheckRoot[tx].in[0] <== step_in[0]; // Commitment is in allowed commitments
        inCheckRoot[tx].in[1] <== inTree[tx].root;
        inCheckRoot[tx].enabled <== inAmount[tx]; // if the amount is zero, we don't need to check the commitment

        // We don't need to range check input amounts, since all inputs are valid UTXOs that
        // were already checked as outputs in the previous transaction (or zero amount UTXOs that don't
        // need to be checked either).
    }

    // add output commitments to the message hash
    for (var tx = 0; tx < nOuts; tx++) {
        messageHasher.inputs[nIns + tx] <== outCommitments[tx];
    }

    // add amount
    messageHasher.inputs[nIns + nOuts] <== amount;

    // verify message hash
    messageHashTree = MerkleProof(levels);
    messageHashTree.leaf <== messageHasher.out;
    messageHashTree.pathIndices <== messageHashPathIndices;
    for (var i = 0; i < levels; i++) {
        messageHashTree.pathElements[i] <== messageHashPathElements[i];
    }

    step_in[1] === messageHashTree.root;

    // allowed message hash
    allowedMessageHashTree = MerkleProof(levels);
    allowedMessageHashTree.leaf <== messageHasher.out;
    allowedMessageHashTree.pathIndices <== allowedMessageHashPathIndices;
    for (var i = 0; i < levels; i++) {
        allowedMessageHashTree.pathElements[i] <== allowedMessageHashPathElements[i];
    }
    // step_in[2] === amount;
    // // check merkle proof only if amount is smaller than MAX_DEPOSIT_AMOUNT
    AllowedMessageHashCheckRoot = ForceEqualIfEnabled();
    AllowedMessageHashCheckRoot.in[0] <== step_in[2]; // Message hash is in allowed message hashes
    AllowedMessageHashCheckRoot.in[1] <== allowedMessageHashTree.root;

    amountComparator = GreaterThan(248);
    amountComparator.in[0] <== -amount;
    amountComparator.in[1] <== 1000000000000000000000;
    AllowedMessageHashCheckRoot.enabled <== amountComparator.out; // if the amount is zero, we don't need to check the message hash

    // AllowedMessageHashCheckRoot.enabled <== amount; // if the amount is zero, we don't need to check the message hash


    // if outputMessageHash is nonzero, it should be equal to messageHasher.out then outputted
    checkOutputMessageHash = ForceEqualIfEnabled();
    checkOutputMessageHash.in[0] <== outputMessageHash;
    checkOutputMessageHash.in[1] <== messageHasher.out;
    checkOutputMessageHash.enabled <== outputMessageHash;
    
    step_out[3] <== outputMessageHash;

    // todo add forceEqual when not enabled 1 - (outputFirstCommitment + outputSecondCommitment)
    step_out[1] <== step_in[1];
    step_out[2] <== step_in[2];

    // add the commitments to AllowedCommitments

    treeBefore = MerkleProof(levels);
    for(var i = 0; i < levels; i++) {
        treeBefore.pathElements[i] <== updatePathElements[i];
    }
    treeBefore.pathIndices <== updatePathIndices;
    treeBefore.leaf <== zeroLeaf;
    treeBefore.root === step_in[0];

    treeAfter = MerkleProof(levels);
    for(var i = 0; i < levels; i++) {
        treeAfter.pathElements[i] <== updatePathElements[i];
    }
    treeAfter.pathIndices <== updatePathIndices;
    treeAfter.leaf <== outCommitments[0];

    // if the outputmessage hash is given, we don't need to give allowedCommitments root. We just output the final value
    checkUpdatePath = ForceEqualIfEnabled();
    checkUpdatePath.in[0] <== allowedCommitmentsNewRoot;
    checkUpdatePath.in[1] <== treeAfter.root;
    checkUpdatePath.enabled <== outputMessageHash - messageHasher.out;
    

    // treeAfter.root === allowedCommitmentsNewRoot;


    step_out[0] <== allowedCommitmentsNewRoot;
}

component main = Step(5, 2, 1, 21663839004416932945382355908790599225266501822907911457504978515578255421292);
