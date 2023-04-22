# Proof of Innocence Arb

Mixers are popular protocols on blockchains allows users to make private transactions by breaking the on-chain link between the recipient and destination addresses. The most used mixer Tornado Cash got sanctioned by OFAC in August 2022 for the reasons that it has been used to launder money. After the sanction we came up with the idea [proof of innocence](https://github.com/chainwayxyz/proof-of-innocence). 

Proof of Innocence is a tool that allows users to prove that their withdrawals from Tornado Cash are not from a list of specified deposits, selected by the user themselves. This allows users to clear their name and demonstrate their innocence without revealing their identity.

Now we further developed the Proof of Innocence to support arbitrary amount of deposits and withdrawals: **Proof of Innocence Arb**.

## Technology

Our enhanced privacy pool, a fork of [Tornado Nova](https://github.com/tornadocash/tornado-nova), supports arbitrary transaction amounts while maintaining the core functionality of the original Proof of Innocence tool. For the sake of practicality and the hackathon, we have downgraded the shielded transaction feature, but retained the ability to support arbitrary deposits and withdrawals.

Each deposit generates a leaf in the Merkle tree using the Poseidon function, which takes the deposit's Ether amount and a random blinding number as inputs. Zero-knowledge proofs are utilized to verify that input commitments remain unspent, input and output amounts match, and other checks are satisfied. This enables users to make multiple deposits and withdraw any amount they desire by organizing commitments accordingly.

The Proof of Innocence circuit functions as a step circuit for each transaction and can be folded using the [Nova Folding Scheme](https://eprint.iacr.org/2021/370). In each step, the circuit verifies the validity of the current transaction, confirms deposits (if any) are from an approved list, and ultimately outputs the withdrawal transaction. Integrating this circuit with the Nova Folding Scheme allows for a succinct proof of the user's allowlist membership for selected deposits.

## TODO:

- UI for the privacy pool
- generating a succint proof of innocence on browser using [Nova Scotia](https://github.com/nalinbhardwaj/Nova-Scotia)
- Add shielded transactions
- Change nullifier architecture to increase security

## Last Words

Please note that the use of Proof of Innocence Arb is at your own risk. Chainway values the importance of open source projects and welcomes any feedback on Proof of Innocence Arb.

