import { Square } from './Square.js';
import {
  isReady,
  shutdown,
  Field,
  Mina,
  PrivateKey,
  AccountUpdate,
} from 'snarkyjs';

import { showTxn, saveTxn, printTxn } from './index.js';

(async function main() {
  await isReady;

  console.log('SnarkyJS loaded');

  const proofsEnabled = false;
  const Local = Mina.LocalBlockchain({ proofsEnabled });
  Mina.setActiveInstance(Local);
  const deployerAccount = Local.testAccounts[0].privateKey;

  if (proofsEnabled) {
    Square.compile();
  }

  // ----------------------------------------------------

  // create a destination we will deploy the smart contract to
  const zkAppPrivateKey = PrivateKey.random();
  const zkAppAddress = zkAppPrivateKey.toPublicKey();

  const legend = {
    [zkAppAddress.toBase58()]: 'zkApp',
    [deployerAccount.toPublicKey().toBase58()]: 'deployer',
  };

  // create an instance of Square - and deploy it to zkAppAddress
  const zkAppInstance = new Square(zkAppAddress);
  const deploy_txn = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    zkAppInstance.deploy({ zkappKey: zkAppPrivateKey });
  });

  await deploy_txn.prove();
  deploy_txn.sign([zkAppPrivateKey]);

  await showTxn(deploy_txn, 'deploy_txn', legend);

  await deploy_txn.send();

  // get the initial state of Square after deployment
  const num0 = zkAppInstance.num.get();
  console.log('state after init:', num0.toString());

  // ----------------------------------------------------

  const txn1 = await Mina.transaction(deployerAccount, () => {
    zkAppInstance.update(Field(9));
  });

  await txn1.prove();
  await txn1.send();

  const num1 = zkAppInstance.num.get();
  console.log('state after txn1:', num1.toString());

  // ----------------------------------------------------

  try {
    const txn2 = await Mina.transaction(deployerAccount, () => {
      zkAppInstance.update(Field(75));
    });

    await txn2.prove();
    await txn2.send();
  } catch (ex: any) {
    console.log(ex.message);
  }

  const num2 = zkAppInstance.num.get();
  console.log('state after txn2:', num2.toString());

  // ----------------------------------------------------

  const txn3 = await Mina.transaction(deployerAccount, () => {
    zkAppInstance.update(Field(81));
  });

  await txn3.prove();
  await txn3.send();

  const num3 = zkAppInstance.num.get();
  console.log('state after txn3:', num3.toString());

  // ----------------------------------------------------

  console.log('Shutting down');

  await shutdown();
})();
