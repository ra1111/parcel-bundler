'use strict';

function _toArray(arr) { return Array.isArray(arr) ? arr : Array.from(arr); }

const t = require('babel-types');
const Path = require('path');
const fs = require('fs');
const template = require('babel-template');

const bufferTemplate = template('Buffer(CONTENT, ENC)');

module.exports = {
  AssignmentExpression(path) {
    if (!isRequire(path.node.right, 'fs', 'readFileSync')) {
      return;
    }

    for (let name in path.getBindingIdentifiers()) {
      const binding = path.scope.getBinding(name);
      if (!binding) continue;

      binding.path.setData('__require', path.node);
    }
  },

  CallExpression(path, asset) {
    let callee = path.node.callee;
    if (referencesImport(path, 'fs', 'readFileSync')) {
      let vars = {
        __dirname: Path.dirname(asset.name),
        __filename: asset.basename
      };

      var _path$get$map = path.get('arguments').map(arg => evaluate(arg, vars)),
          _path$get$map2 = _toArray(_path$get$map);

      let filename = _path$get$map2[0],
          args = _path$get$map2.slice(1);

      filename = Path.resolve(filename);

      let res = fs.readFileSync(filename, ...args);
      let replacementNode;
      if (Buffer.isBuffer(res)) {
        replacementNode = bufferTemplate({
          CONTENT: t.stringLiteral(res.toString('base64')),
          ENC: t.stringLiteral('base64')
        });
      } else {
        replacementNode = t.stringLiteral(res);
      }

      asset.addDependency(filename, { includedInParent: true });
      path.replaceWith(replacementNode);
      asset.isAstDirty = true;
    }
  }
};

function isRequire(node, name, method) {
  // e.g. require('fs').readFileSync
  if (t.isMemberExpression(node) && node.property.name === method) {
    node = node.object;
  }

  if (!t.isCallExpression(node)) {
    return false;
  }

  var _node = node;
  let callee = _node.callee,
      args = _node.arguments;

  let isRequire = t.isIdentifier(callee) && callee.name === 'require' && args.length === 1 && t.isStringLiteral(args[0]);

  if (!isRequire) {
    return false;
  }

  if (name && args[0].value !== name) {
    return false;
  }

  return true;
}

function referencesImport(path, name, method) {
  let callee = path.node.callee;
  let bindingPath;

  // e.g. readFileSync()
  if (t.isIdentifier(callee)) {
    bindingPath = getBindingPath(path, callee.name);
  } else if (t.isMemberExpression(callee)) {
    if (callee.property.name !== method) {
      return false;
    }

    // e.g. fs.readFileSync()
    if (t.isIdentifier(callee.object)) {
      bindingPath = getBindingPath(path, callee.object.name);

      // require('fs').readFileSync()
    } else if (isRequire(callee.object, name)) {
      return true;
    }
  } else {
    return false;
  }

  if (!bindingPath) {
    return;
  }

  let bindingNode = bindingPath.getData('__require') || bindingPath.node;
  let parent = bindingPath.parentPath;

  // e.g. import fs from 'fs';
  if (parent.isImportDeclaration()) {
    if (bindingPath.isImportSpecifier() && bindingPath.node.imported.name !== method) {
      return false;
    }

    return parent.node.source.value === name;

    // e.g. var fs = require('fs');
  } else if (t.isVariableDeclarator(bindingNode) || t.isAssignmentExpression(bindingNode)) {
    let left = bindingNode.id || bindingNode.left;
    let right = bindingNode.init || bindingNode.right;

    // e.g. var {readFileSync} = require('fs');
    if (t.isObjectPattern(left)) {
      let prop = left.properties.find(p => p.value.name === callee.name);
      if (!prop || prop.key.name !== method) {
        return false;
      }
    } else if (!t.isIdentifier(left)) {
      return false;
    }

    return isRequire(right, name, method);
  }

  return false;
}

function getBindingPath(path, name) {
  let binding = path.scope.getBinding(name);
  return binding && binding.path;
}

function evaluate(path, vars) {
  // Inline variables
  path.traverse({
    Identifier: function Identifier(ident) {
      let key = ident.node.name;
      if (key in vars) {
        ident.replaceWith(t.valueToNode(vars[key]));
      }
    }
  });

  let res = path.evaluate();
  if (!res.confident) {
    throw new Error('Could not statically evaluate fs call');
  }

  return res.value;
}