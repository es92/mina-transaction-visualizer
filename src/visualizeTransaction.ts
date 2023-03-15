import graphviz from 'graphviz';
import util from 'util';
import crypto from 'crypto';
import os from 'os';

import { exec } from 'child_process';

import fs from 'fs';
import fsp from 'fs/promises';

import { Mina, Token, Encoding } from 'snarkyjs';

type Legend = { [pk: string]: string };

// ====================================================================

export const showTxn = async (
  txn: Mina.Transaction,
  name: string,
  legend: Legend
) => {
  const txnJSON = _makeTxnJSON(txn, name, legend);
  const g = _makeGraphQL(txnJSON);

  const tempFile = os.tmpdir() + '/' + name + '.png';

  g.output('png', tempFile);
  await waitForFileExists(tempFile);

  openImage(tempFile);
};

// ====================================================================

export const saveTxn = (
  txn: Mina.Transaction,
  name: string,
  legend: Legend,
  path: string
) => {
  const txnJSON = _makeTxnJSON(txn, name, legend);
  const g = _makeGraphQL(txnJSON);

  g.output('png', path);
  //console.log(g.to_dot());
};

// ====================================================================

export const printTxn = (
  txn: Mina.Transaction,
  name: string,
  legend: Legend
) => {
  const txnJSON = _makeTxnJSON(txn, name, legend);
  console.log(
    util.inspect(txnJSON, { showHidden: false, depth: null, colors: true })
  );
};

// ====================================================================

const _makeGraphQL = (minaJSON: any) => {
  let g = graphviz.digraph('G');

  g.set('label', minaJSON.name);
  g.set('labelloc', 't'); // Position the label at the top of the graph
  g.set('fontsize', '18'); // Set the font size for the label

  let idx = 0;

  function addNodes(accountUpdates: any, parent: any) {
    accountUpdates.forEach((au: any) => {
      const content = { ...au };
      delete content.children;
      delete content.idx;
      const label =
        util
          .inspect(content, { showHidden: false, depth: null, colors: false })
          .replaceAll('"', "'")
          .split('\n')
          .slice(1, -1)
          .join('\\l') + '\\l';
      const node = g.addNode('' + idx++, { label, fontname: 'monospace' });
      if (parent != null) {
        g.addEdge(parent, node);
      }

      addNodes(au.children, node);
    });
  }

  addNodes(minaJSON.accountUpdates, null);
  return g;
};

// ====================================================================

const _makeTxnJSON = (
  minaTxn: Mina.Transaction,
  name: string,
  legend: Legend
) => {
  legend[Encoding.TokenId.toBase58(Token.Id.default)] = 'MINA';

  const txn = JSON.parse(minaTxn.toJSON());
  const txnJSON: any = {
    name,
    legend,
    accountUpdates: [],
  };

  const parentStack = [];

  for (let [idx, au] of txn.accountUpdates.entries()) {
    if (au.authorization.proof != null) {
      au.authorization.proof = '...' + au.authorization.proof.slice(-6);
    }
    if (au.authorization.signature != null) {
      au.authorization.signature = '...' + au.authorization.signature.slice(-6);
    }
    if (au.body.authorizationKind.verificationKeyHash != null) {
      au.body.authorizationKind.verificationKeyHash =
        '...' + au.body.authorizationKind.verificationKeyHash.slice(-6);
    }
    if (au.body.update.verificationKey != null) {
      au.body.update.verificationKey.data =
        '...' + au.body.update.verificationKey.data.slice(-6);
      au.body.update.verificationKey.hash =
        '...' + au.body.update.verificationKey.hash.slice(-6);
    }
    if (au.body.update.appState != null) {
      if (au.body.update.appState.every((x: any) => x == '0')) {
        au.body.update.appState = '0s';
      } else {
        au.body.update.appState = au.body.update.appState
          .map((u: any, i: any) => [i, u])
          .filter((x: any) => x[1] != null);
        if (au.body.update.appState == '[]') {
          delete au.body.update.appState;
        }
      }
    }
    au.idx = idx;
    au.body.update = removeNull(au.body.update);
    au.body.preconditions = removeNull(au.body.preconditions);

    if (au.body.publicKey in legend) {
      au.body.publicKey = legend[au.body.publicKey];
    } else {
      au.body.publicKey = '...' + au.body.publicKey.slice(-6);
    }

    if (au.body.tokenId in legend) {
      au.body.tokenId = legend[au.body.tokenId];
    } else {
      au.body.tokenId = '...' + au.body.tokenId.slice(-6);
    }

    if (
      !au.body.mayUseToken.parentsOwnToken &&
      !au.body.mayUseToken.inheritFromParent
    ) {
      delete au.body.mayUseToken;
    }

    if (au.body.events.length == 0) {
      delete au.body.events;
    }
    if (au.body.actions.length == 0) {
      delete au.body.actions;
    }

    let authorization;
    if (au.authorization.proof != null) {
      authorization = 'proof';
    } else if (au.authorization.signature != null) {
      authorization = 'signature';
    } else {
      authorization = 'none';
    }

    const content: any = {
      idx: au.idx,
      publicKey: au.body.publicKey,
      tokenId: au.body.tokenId,
      balanceChange:
        (au.body.balanceChange.sgn == 'Positive' ? '+' : '-') +
        au.body.balanceChange.magnitude / 1e9,
      update: au.body.update,
      authorization,
      children: [],
    };

    if (au.body.mayUseToken != null) {
      content.mayUseToken = au.body.mayUseToken;
    }

    au.content = content;

    if (parentStack.length > 0) {
      const lastAu = parentStack[parentStack.length - 1];
      if (au.body.callDepth <= lastAu.body.callDepth) {
        const diff = lastAu.body.callDepth - au.body.callDepth + 1;
        for (let i = 0; i < diff; i++) {
          parentStack.pop();
        }
      }

      if (parentStack.length > 0) {
        const parentAu = parentStack[parentStack.length - 1];
        parentAu.content.children.push(content);
      } else {
        txnJSON.accountUpdates.push(content);
      }
    } else {
      txnJSON.accountUpdates.push(content);
    }

    parentStack.push(au);
  }

  return txnJSON;
};

// ====================================================================

function removeNull(obj: any) {
  if (obj == null) {
    return null;
  } else if (typeof obj == 'object') {
    let allNull = true;
    for (let key of Object.keys(obj)) {
      let val = removeNull(obj[key]);
      if (val == null) {
        delete obj[key];
      } else {
        obj[key] = val;
        allNull = false;
      }
    }
    if (allNull) {
      return null;
    }
  }
  return obj;
}

// ====================================================================

function openImage(imagePath: string) {
  const platform = process.platform;

  let command;
  if (platform === 'darwin') {
    // macOS
    command = `open "${imagePath}"`;
  } else if (platform === 'linux') {
    // Linux
    command = `xdg-open "${imagePath}"`;
  } else {
    console.error('Unsupported platform:', platform);
    return;
  }

  console.log(command);

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error opening image:', error);
      return;
    }
  });
}

// ====================================================================

async function waitForFileExists(
  filePath: string,
  interval = 100
): Promise<any> {
  try {
    await fsp.access(filePath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet, wait and retry
      await new Promise((resolve) => setTimeout(resolve, interval));
      return waitForFileExists(filePath, interval);
    } else {
      // Other error, re-throw
      throw err;
    }
  }
}

// ====================================================================
