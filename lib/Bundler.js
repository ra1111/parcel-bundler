'use strict';

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const fs = require('./utils/fs');
const Resolver = require('./Resolver');
const Parser = require('./Parser');
const WorkerFarm = require('./WorkerFarm');
const worker = require('./utils/promisify')(require('./worker.js'));
const Path = require('path');
const Bundle = require('./Bundle');

var _require = require('chokidar');

const FSWatcher = _require.FSWatcher;

const FSCache = require('./FSCache');
const HMRServer = require('./HMRServer');
const Server = require('./Server');

var _require2 = require('events');

const EventEmitter = _require2.EventEmitter;

const Logger = require('./Logger');
const PackagerRegistry = require('./packagers');
const localRequire = require('./utils/localRequire');
const customErrors = require('./utils/customErrors');
const config = require('./utils/config');

/**
 * The Bundler is the main entry point. It resolves and loads assets,
 * creates the bundle tree, and manages the worker farm, cache, and file watcher.
 */
class Bundler extends EventEmitter {
  constructor(main, options = {}) {
    super();
    this.mainFile = Path.resolve(main || '');
    this.options = this.normalizeOptions(options);

    this.resolver = new Resolver(this.options);
    this.parser = new Parser(this.options);
    this.packagers = new PackagerRegistry();
    this.cache = this.options.cache ? new FSCache(this.options) : null;
    this.logger = new Logger(this.options);
    this.delegate = options.delegate || {};

    this.pending = false;
    this.loadedAssets = new Map();
    this.farm = null;
    this.watcher = null;
    this.hmr = null;
    this.bundleHashes = null;
    this.errored = false;
    this.buildQueue = new Set();
    this.rebuildTimeout = null;
  }

  normalizeOptions(options) {
    const isProduction = options.production || process.env.NODE_ENV === 'production';
    const publicURL = options.publicUrl || options.publicURL || '/' + Path.basename(options.outDir || 'dist');
    const watch = typeof options.watch === 'boolean' ? options.watch : !isProduction;
    return {
      outDir: Path.resolve(options.outDir || 'dist'),
      publicURL: publicURL,
      watch: watch,
      cache: typeof options.cache === 'boolean' ? options.cache : true,
      killWorkers: typeof options.killWorkers === 'boolean' ? options.killWorkers : true,
      minify: typeof options.minify === 'boolean' ? options.minify : isProduction,
      hmr: typeof options.hmr === 'boolean' ? options.hmr : watch,
      logLevel: typeof options.logLevel === 'number' ? options.logLevel : 3
    };
  }

  addAssetType(extension, path) {
    if (typeof path !== 'string') {
      throw new Error('Asset type should be a module path.');
    }

    if (this.farm) {
      throw new Error('Asset types must be added before bundling.');
    }

    this.parser.registerExtension(extension, path);
  }

  addPackager(type, packager) {
    if (this.farm) {
      throw new Error('Packagers must be added before bundling.');
    }

    this.packagers.add(type, packager);
  }

  loadPlugins() {
    var _this = this;

    return _asyncToGenerator(function* () {
      let pkg = yield config.load(_this.mainFile, ['package.json']);
      if (!pkg) {
        return;
      }

      try {
        let deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
        for (let dep in deps) {
          if (dep.startsWith('parcel-plugin-')) {
            localRequire(dep, _this.mainFile)(_this);
          }
        }
      } catch (err) {
        _this.logger.warn(err);
      }
    })();
  }

  bundle() {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      // If another bundle is already pending, wait for that one to finish and retry.
      if (_this2.pending) {
        return new Promise(function (resolve, reject) {
          _this2.once('buildEnd', function () {
            _this2.bundle().then(resolve, reject);
          });
        });
      }

      let isInitialBundle = !_this2.mainAsset;
      let startTime = Date.now();
      _this2.pending = true;
      _this2.errored = false;

      _this2.logger.clear();
      _this2.logger.status('⏳', 'Building...');

      try {
        // Start worker farm, watcher, etc. if needed
        yield _this2.start();

        // If this is the initial bundle, ensure the output directory exists, and resolve the main asset.
        if (isInitialBundle) {
          yield fs.mkdirp(_this2.options.outDir);

          _this2.mainAsset = yield _this2.resolveAsset(_this2.mainFile);
          _this2.buildQueue.add(_this2.mainAsset);
        }

        // Build the queued assets, and produce a bundle tree.
        let bundle = yield _this2.buildQueuedAssets(isInitialBundle);

        let buildTime = Date.now() - startTime;
        let time = buildTime < 1000 ? `${buildTime}ms` : `${(buildTime / 1000).toFixed(2)}s`;
        _this2.logger.status('✨', `Built in ${time}.`, 'green');

        return bundle;
      } catch (err) {
        _this2.errored = true;
        _this2.logger.error(err);
        if (_this2.hmr) {
          _this2.hmr.emitError(err);
        }

        if (process.env.NODE_ENV === 'production') {
          process.exitCode = 1;
        }
      } finally {
        _this2.pending = false;
        _this2.emit('buildEnd');

        // If not in watch mode, stop the worker farm so we don't keep the process running.
        if (!_this2.watcher && _this2.options.killWorkers) {
          _this2.stop();
        }
      }
    })();
  }

  start() {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      if (_this3.farm) {
        return;
      }

      yield _this3.loadPlugins();

      _this3.options.extensions = Object.assign({}, _this3.parser.extensions);
      _this3.farm = WorkerFarm.getShared(_this3.options);

      if (_this3.options.watch) {
        // FS events on macOS are flakey in the tests, which write lots of files very quickly
        // See https://github.com/paulmillr/chokidar/issues/612
        _this3.watcher = new FSWatcher({
          useFsEvents: process.env.NODE_ENV !== 'test'
        });

        _this3.watcher.on('change', _this3.onChange.bind(_this3));
      }

      if (_this3.options.hmr) {
        _this3.hmr = new HMRServer();
        _this3.options.hmrPort = yield _this3.hmr.start();
      }
    })();
  }

  stop() {
    if (this.farm) {
      this.farm.end();
    }

    if (this.watcher) {
      this.watcher.close();
    }

    if (this.hmr) {
      this.hmr.stop();
    }
  }

  buildQueuedAssets(isInitialBundle = false) {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      // Consume the rebuild queue until it is empty.
      let loadedAssets = new Set();
      while (_this4.buildQueue.size > 0) {
        let promises = [];
        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
          for (var _iterator = _this4.buildQueue[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            let asset = _step.value;

            // Invalidate the asset, unless this is the initial bundle
            if (!isInitialBundle) {
              asset.invalidate();
              if (_this4.cache) {
                _this4.cache.invalidate(asset.name);
              }
            }

            promises.push(_this4.loadAsset(asset));
            loadedAssets.add(asset);
          }

          // Wait for all assets to load. If there are more added while
          // these are processing, they'll be loaded in the next batch.
        } catch (err) {
          _didIteratorError = true;
          _iteratorError = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion && _iterator.return) {
              _iterator.return();
            }
          } finally {
            if (_didIteratorError) {
              throw _iteratorError;
            }
          }
        }

        yield Promise.all(promises);
      }

      // Emit an HMR update for any new assets (that don't have a parent bundle yet)
      // plus the asset that actually changed.
      if (_this4.hmr && !isInitialBundle) {
        _this4.hmr.emitUpdate([..._this4.findOrphanAssets(), ...loadedAssets]);
      }

      // Invalidate bundles
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        for (var _iterator2 = _this4.loadedAssets.values()[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          let asset = _step2.value;

          asset.invalidateBundle();
        }

        // Create a new bundle tree and package everything up.
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion2 && _iterator2.return) {
            _iterator2.return();
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }

      let bundle = _this4.createBundleTree(_this4.mainAsset);
      _this4.bundleHashes = yield bundle.package(_this4, _this4.bundleHashes);

      // Unload any orphaned assets
      _this4.unloadOrphanedAssets();

      _this4.emit('bundled', bundle);
      return bundle;
    })();
  }

  resolveAsset(name, parent) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      var _ref = yield _this5.resolver.resolve(name, parent);

      let path = _ref.path,
          pkg = _ref.pkg;

      if (_this5.loadedAssets.has(path)) {
        return _this5.loadedAssets.get(path);
      }

      let asset = _this5.parser.getAsset(path, pkg, _this5.options);
      _this5.loadedAssets.set(path, asset);

      if (_this5.watcher) {
        _this5.watcher.add(path);
      }

      return asset;
    })();
  }

  resolveDep(asset, dep) {
    var _this6 = this;

    return _asyncToGenerator(function* () {
      try {
        return yield _this6.resolveAsset(dep.name, asset.name);
      } catch (err) {
        if (err.message.indexOf(`Cannot find module '${dep.name}'`) === 0) {
          err.message = `Cannot resolve dependency '${dep.name}'`;

          // Generate a code frame where the dependency was used
          if (dep.loc) {
            yield asset.loadIfNeeded();
            err.loc = dep.loc;
            err = asset.generateErrorMessage(err);
          }

          err.fileName = asset.name;
        }
        throw err;
      }
    })();
  }

  loadAsset(asset) {
    var _this7 = this;

    return _asyncToGenerator(function* () {
      if (asset.processed) {
        _this7.buildQueue.delete(asset);
        return;
      }

      if (!_this7.errored) {
        _this7.logger.status('⏳', `Building ${asset.basename}...`);
      }

      // Mark the asset processed so we don't load it twice
      asset.processed = true;

      // First try the cache, otherwise load and compile in the background
      let processed = _this7.cache && (yield _this7.cache.read(asset.name));
      if (!processed) {
        processed = yield _this7.farm.run(asset.name, asset.package, _this7.options);
        if (_this7.cache) {
          _this7.cache.write(asset.name, processed);
        }
      }

      asset.generated = processed.generated;
      asset.hash = processed.hash;

      // Call the delegate to get implicit dependencies
      let dependencies = processed.dependencies;
      if (_this7.delegate.getImplicitDependencies) {
        let implicitDeps = yield _this7.delegate.getImplicitDependencies(asset);
        if (implicitDeps) {
          dependencies = dependencies.concat(implicitDeps);
        }
      }

      // Process asset dependencies
      yield Promise.all(dependencies.map((() => {
        var _ref2 = _asyncToGenerator(function* (dep) {
          let assetDep = yield _this7.resolveDep(asset, dep);
          if (dep.includedInParent) {
            // This dependency is already included in the parent's generated output,
            // so no need to load it. We map the name back to the parent asset so
            // that changing it triggers a recompile of the parent.
            _this7.loadedAssets.set(dep.name, asset);
          } else {
            asset.dependencies.set(dep.name, dep);
            asset.depAssets.set(dep.name, assetDep);
            yield _this7.loadAsset(assetDep);
          }
        });

        return function (_x) {
          return _ref2.apply(this, arguments);
        };
      })()));

      _this7.buildQueue.delete(asset);
    })();
  }

  createBundleTree(asset, dep, bundle) {
    if (dep) {
      asset.parentDeps.add(dep);
    }

    if (asset.parentBundle) {
      // If the asset is already in a bundle, it is shared. Move it to the lowest common ancestor.
      if (asset.parentBundle !== bundle) {
        let commonBundle = bundle.findCommonAncestor(asset.parentBundle);
        if (asset.parentBundle !== commonBundle && asset.parentBundle.type === commonBundle.type) {
          this.moveAssetToBundle(asset, commonBundle);
        }
      }

      return;
    }

    // Create the root bundle if it doesn't exist
    if (!bundle) {
      bundle = new Bundle(asset.type, Path.join(this.options.outDir, asset.generateBundleName(true)));
      bundle.entryAsset = asset;
    }

    // Create a new bundle for dynamic imports
    if (dep && dep.dynamic) {
      bundle = bundle.createChildBundle(asset.type, Path.join(this.options.outDir, asset.generateBundleName()));
      bundle.entryAsset = asset;
    }

    // Add the asset to the bundle of the asset's type
    bundle.getSiblingBundle(asset.type).addAsset(asset);

    // If the asset generated a representation for the parent bundle type, also add it there
    if (asset.generated[bundle.type] != null) {
      bundle.addAsset(asset);
    }

    asset.parentBundle = bundle;

    var _iteratorNormalCompletion3 = true;
    var _didIteratorError3 = false;
    var _iteratorError3 = undefined;

    try {
      for (var _iterator3 = asset.dependencies.values()[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
        let dep = _step3.value;

        let assetDep = asset.depAssets.get(dep.name);
        this.createBundleTree(assetDep, dep, bundle);
      }
    } catch (err) {
      _didIteratorError3 = true;
      _iteratorError3 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion3 && _iterator3.return) {
          _iterator3.return();
        }
      } finally {
        if (_didIteratorError3) {
          throw _iteratorError3;
        }
      }
    }

    return bundle;
  }

  moveAssetToBundle(asset, commonBundle) {
    var _iteratorNormalCompletion4 = true;
    var _didIteratorError4 = false;
    var _iteratorError4 = undefined;

    try {
      for (var _iterator4 = Array.from(asset.bundles)[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
        let bundle = _step4.value;

        bundle.removeAsset(asset);
        commonBundle.getSiblingBundle(bundle.type).addAsset(asset);
      }
    } catch (err) {
      _didIteratorError4 = true;
      _iteratorError4 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion4 && _iterator4.return) {
          _iterator4.return();
        }
      } finally {
        if (_didIteratorError4) {
          throw _iteratorError4;
        }
      }
    }

    let oldBundle = asset.parentBundle;
    asset.parentBundle = commonBundle;

    // Move all dependencies as well
    var _iteratorNormalCompletion5 = true;
    var _didIteratorError5 = false;
    var _iteratorError5 = undefined;

    try {
      for (var _iterator5 = asset.depAssets.values()[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
        let child = _step5.value;

        if (child.parentBundle === oldBundle) {
          this.moveAssetToBundle(child, commonBundle);
        }
      }
    } catch (err) {
      _didIteratorError5 = true;
      _iteratorError5 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion5 && _iterator5.return) {
          _iterator5.return();
        }
      } finally {
        if (_didIteratorError5) {
          throw _iteratorError5;
        }
      }
    }
  }

  *findOrphanAssets() {
    var _iteratorNormalCompletion6 = true;
    var _didIteratorError6 = false;
    var _iteratorError6 = undefined;

    try {
      for (var _iterator6 = this.loadedAssets.values()[Symbol.iterator](), _step6; !(_iteratorNormalCompletion6 = (_step6 = _iterator6.next()).done); _iteratorNormalCompletion6 = true) {
        let asset = _step6.value;

        if (!asset.parentBundle) {
          yield asset;
        }
      }
    } catch (err) {
      _didIteratorError6 = true;
      _iteratorError6 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion6 && _iterator6.return) {
          _iterator6.return();
        }
      } finally {
        if (_didIteratorError6) {
          throw _iteratorError6;
        }
      }
    }
  }

  unloadOrphanedAssets() {
    var _iteratorNormalCompletion7 = true;
    var _didIteratorError7 = false;
    var _iteratorError7 = undefined;

    try {
      for (var _iterator7 = this.findOrphanAssets()[Symbol.iterator](), _step7; !(_iteratorNormalCompletion7 = (_step7 = _iterator7.next()).done); _iteratorNormalCompletion7 = true) {
        let asset = _step7.value;

        this.unloadAsset(asset);
      }
    } catch (err) {
      _didIteratorError7 = true;
      _iteratorError7 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion7 && _iterator7.return) {
          _iterator7.return();
        }
      } finally {
        if (_didIteratorError7) {
          throw _iteratorError7;
        }
      }
    }
  }

  unloadAsset(asset) {
    this.loadedAssets.delete(asset.name);
    if (this.watcher) {
      this.watcher.unwatch(asset.name);
    }
  }

  onChange(path) {
    var _this8 = this;

    return _asyncToGenerator(function* () {
      let asset = _this8.loadedAssets.get(path);
      if (!asset) {
        return;
      }

      _this8.logger.clear();
      _this8.logger.status('⏳', `Building ${asset.basename}...`);

      // Add the asset to the rebuild queue, and reset the timeout.
      _this8.buildQueue.add(asset);
      clearTimeout(_this8.rebuildTimeout);

      _this8.rebuildTimeout = setTimeout(_asyncToGenerator(function* () {
        yield _this8.bundle();
      }), 100);
    })();
  }

  middleware() {
    return Server.middleware(this);
  }

  serve(port = 1234) {
    var _this9 = this;

    return _asyncToGenerator(function* () {
      _this9.bundle();
      return yield Server.serve(_this9, port);
    })();
  }
}

module.exports = Bundler;
Bundler.Asset = require('./Asset');
Bundler.Packager = require('./packagers/Packager');