/* globals describe, it, afterEach, __dirname */
import {
    expect
} from 'chai';
import CopyWebpackPlugin from './../src';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import Promise from 'bluebird';

const BUILD_DIR = path.join(__dirname, 'build');
const HELPER_DIR = path.join(__dirname, 'helpers');
const TEMP_DIR = path.join(__dirname, 'tempdir');

class MockCompiler {
    constructor () {
        this.options = {
            context: HELPER_DIR,
            output: {
                path: BUILD_DIR
            }
        };

        this.outputFileSystem = {
            constructor: {
                name: 'NotMemoryFileSystem'
            }
        };
    }

    plugin (type, fn) {
        if (type === 'emit') {
            this.emitFn = fn;
        }

        if (type === 'after-emit') {
            this.afterEmitFn = fn;
        }
    }
}

describe('apply function', () => {
    // Ideally we pass in patterns and confirm the resulting assets
    const run = (opts) => {
        return new Promise((resolve, reject) => {
            const plugin = CopyWebpackPlugin(opts.patterns, opts.options);

            // Get a mock compiler to pass to plugin.apply
            const compiler = opts.compiler || new MockCompiler();

            plugin.apply(compiler);

            // Call the registered function with a mock compilation and callback
            const compilation = _.assignIn({
                assets: {},
                contextDependencies: [],
                errors: [],
                fileDependencies: []
            }, opts.compilation);

            // Execute the functions in series
            Promise.each([
                compiler.emitFn,
                compiler.afterEmitFn
            ], (fn) => {
                return new Promise((res, rej) => {
                    try {
                        fn(compilation, res);
                    } catch (error) {
                        rej(error);
                    }
                });
            })
            .then(() => {
                if (compilation.errors.length > 0) {
                    throw compilation.errors[0];
                }
                resolve(compilation);
            })
            .catch(reject);
        });
    };

    const runEmit = (opts) => {
        return run(opts)
            .then((compilation) => {
                if (opts.expectedAssetKeys && opts.expectedAssetKeys.length > 0) {
                    expect(compilation.assets).to.have.all.keys(opts.expectedAssetKeys);
                } else {
                    expect(compilation.assets).to.deep.equal({});
                }
            });
    };

    const runForce = (opts) => {
        opts.compilation = {
            assets: {}
        };
        opts.compilation.assets[opts.existingAsset] = {
            source () {
                return 'existing';
            }
        };

        return run(opts)
            .then((compilation) => {
                const assetContent = compilation.assets[opts.existingAsset].source().toString();

                expect(assetContent).to.equal(opts.expectedAssetContent);
            });
    };

    const runChange = (opts) => {
        // Create two test files
        fs.writeFileSync(opts.newFileLoc1, 'file1contents');
        fs.writeFileSync(opts.newFileLoc2, 'file2contents');

        // Create a reference to the compiler
        const compiler = new MockCompiler();
        const compilation = {
            assets: {},
            contextDependencies: [],
            errors: [],
            fileDependencies: []
        };

        return run({
            compiler,
            options: opts.options,
            patterns: opts.patterns
        })
        // mtime is only measured in whole seconds
        .delay(1000)
        .then(() => {
            // Change a file
            fs.appendFileSync(opts.newFileLoc1, 'extra');

            // Trigger another compile
            return new Promise((res) => {
                compiler.emitFn(compilation, res);
            });
        })
        .then(() => {
            if (opts.expectedAssetKeys && opts.expectedAssetKeys.length > 0) {
                expect(compilation.assets).to.have.all.keys(opts.expectedAssetKeys);
            } else {
                expect(compilation.assets).to.deep.equal({});
            }
        })
        .finally(() => {
            fs.unlinkSync(opts.newFileLoc1);
            fs.unlinkSync(opts.newFileLoc2);
        });
    };

    // Use then and catch explicitly, so errors
    // aren't seen as unhandled exceptions
    describe('error handling', () => {
        it('doesn\'t throw an error if no patterns are passed', (done) => {
            runEmit({
                expectedAssetKeys: [],
                /* eslint-disable no-undefined */
                patterns: undefined
                /* eslint-enable */
            })
            .then(done)
            .catch(done);
        });

        it('throws an error if the patterns are an object', () => {
            const createPluginWithObject = () => {
                CopyWebpackPlugin({});
            };

            expect(createPluginWithObject).to.throw(Error);
        });

        it('throws an error if the patterns are null', () => {
            const createPluginWithNull = () => {
                CopyWebpackPlugin(null);
            };

            expect(createPluginWithNull).to.throw(Error);
        });
    });

    describe('with file in from', () => {
        it('can move a file to the root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'file.txt'
                ],
                patterns: [{
                    from: 'file.txt'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use an absolute path to move a file to the root directory', (done) => {
            const absolutePath = path.resolve(HELPER_DIR, 'file.txt');

            runEmit({
                expectedAssetKeys: [
                    'file.txt'
                ],
                patterns: [{
                    from: absolutePath
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use a glob to move a file to the root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'file.txt'
                ],
                patterns: [{
                    from: '*.txt'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use a glob to move multiple files to the root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'file.txt',
                    'directory/directoryfile.txt',
                    'directory/nested/nestedfile.txt'
                ],
                patterns: [{
                    from: '**/*.txt'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use a glob to move multiple files to a non-root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'nested/file.txt',
                    'nested/directory/directoryfile.txt',
                    'nested/directory/nested/nestedfile.txt'
                ],
                patterns: [{
                    from: '**/*.txt',
                    to: 'nested'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use a glob to move multiple files in a different relative context to a non-root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'nested/directoryfile.txt',
                    'nested/nested/nestedfile.txt'
                ],
                patterns: [{
                    context: 'directory',
                    from: '**/*.txt',
                    to: 'nested'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use a glob to flatten multiple files in a relative context to a non-root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'nested/directoryfile.txt',
                    'nested/nestedfile.txt'
                ],
                patterns: [{
                    context: 'directory',
                    flatten: true,
                    from: '**/*.txt',
                    to: 'nested'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use a glob to move multiple files in a different absolute context to a non-root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'nested/directoryfile.txt',
                    'nested/nested/nestedfile.txt'
                ],
                patterns: [{
                    context: path.join(HELPER_DIR, 'directory'),
                    from: '**/*.txt',
                    to: 'nested'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use a glob with a full path to move a file to the root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'file.txt'
                ],
                patterns: [{
                    from: path.join(HELPER_DIR, '*.txt')
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use a glob with a full path to move multiple files to the root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'file.txt',
                    'directory/directoryfile.txt',
                    'directory/nested/nestedfile.txt'
                ],
                patterns: [{
                    from: path.join(HELPER_DIR, '**/*.txt')
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a file to a new directory without a forward slash', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newdirectory/file.txt'
                ],
                patterns: [{
                    from: 'file.txt',
                    to: 'newdirectory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a file to the root directory using an absolute to', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'file.txt'
                ],
                patterns: [{
                    from: 'file.txt',
                    to: BUILD_DIR
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a file to a new directory using an absolute to', (done) => {
            runEmit({
                expectedAssetKeys: [
                    '../tempdir/file.txt'
                ],
                patterns: [{
                    from: 'file.txt',
                    to: TEMP_DIR
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a file to a new file using an absolute to', (done) => {
            const absolutePath = path.resolve(TEMP_DIR, 'newfile.txt');

            runEmit({
                expectedAssetKeys: [
                    '../tempdir/newfile.txt'
                ],
                patterns: [{
                    from: 'file.txt',
                    to: absolutePath
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a file to a new directory with a forward slash', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newdirectory/file.txt'
                ],
                patterns: [{
                    from: 'file.txt',
                    to: 'newdirectory/'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a file to a new directory with an extension', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newdirectory.ext/file.txt'
                ],
                patterns: [{
                    from: 'file.txt',
                    to: 'newdirectory.ext',
                    toType: 'dir'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a file to a new directory with an extension and forward slash', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newdirectory.ext/file.txt'
                ],
                patterns: [{
                    from: 'file.txt',
                    to: 'newdirectory.ext/'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a file to a new file with a different name', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newname.txt'
                ],
                patterns: [{
                    from: 'file.txt',
                    to: 'newname.txt'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a file to a new file with no extension', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newname'
                ],
                patterns: [{
                    from: 'file.txt',
                    to: 'newname',
                    toType: 'file'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a nested file to the root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'directoryfile.txt'
                ],
                patterns: [{
                    from: 'directory/directoryfile.txt'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use an absolute path to move a nested file to the root directory', (done) => {
            const absolutePath = path.resolve(HELPER_DIR, 'directory', 'directoryfile.txt');

            runEmit({
                expectedAssetKeys: [
                    'directoryfile.txt'
                ],
                patterns: [{
                    from: absolutePath
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a nested file to a new directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newdirectory/directoryfile.txt'
                ],
                patterns: [{
                    from: 'directory/directoryfile.txt',
                    to: 'newdirectory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use an absolute path to move a nested file to a new directory', (done) => {
            const absolutePath = path.resolve(HELPER_DIR, 'directory', 'directoryfile.txt');

            runEmit({
                expectedAssetKeys: [
                    'newdirectory/directoryfile.txt'
                ],
                patterns: [{
                    from: absolutePath,
                    to: 'newdirectory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('won\'t overwrite a file already in the compilation', (done) => {
            runForce({
                existingAsset: 'file.txt',
                expectedAssetContent: 'existing',
                patterns: [{
                    from: 'file.txt'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can force overwrite of a file already in the compilation', (done) => {
            runForce({
                existingAsset: 'file.txt',
                expectedAssetContent: 'new',
                patterns: [{
                    force: true,
                    from: 'file.txt'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('adds the file to the watch list', (done) => {
            run({
                patterns: [{
                    from: 'file.txt'
                }]
            })
            .then((compilation) => {
                const absFrom = path.join(HELPER_DIR, 'file.txt');

                expect(compilation.fileDependencies).to.have.members([absFrom]);
            })
            .then(done)
            .catch(done);
        });

        it('only include files that have changed', (done) => {
            runChange({
                expectedAssetKeys: [
                    'tempfile1.txt'
                ],
                newFileLoc1: path.join(HELPER_DIR, 'tempfile1.txt'),
                newFileLoc2: path.join(HELPER_DIR, 'tempfile2.txt'),
                patterns: [{
                    from: 'tempfile1.txt'
                }, {
                    from: 'tempfile2.txt'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('ignores files in pattern', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'directory/directoryfile.txt',
                    'directory/nested/nestedfile.txt'
                ],
                patterns: [{
                    from: '**/*.txt',
                    ignore: [
                        'file.*'
                    ]
                }]
            })
            .then(done)
            .catch(done);
        });
    });

    describe('with directory in from', () => {
        it('can move a directory\'s contents to the root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'directoryfile.txt',
                    'nested/nestedfile.txt'
                ],
                patterns: [{
                    from: 'directory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use an absolute path to move a directory\'s contents to the root directory', (done) => {
            const absolutePath = path.resolve(HELPER_DIR, 'directory');

            runEmit({
                expectedAssetKeys: [
                    'directoryfile.txt',
                    'nested/nestedfile.txt'
                ],
                patterns: [{
                    from: absolutePath
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a directory\'s contents to a new directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newdirectory/directoryfile.txt',
                    'newdirectory/nested/nestedfile.txt'
                ],
                patterns: [{
                    from: 'directory',
                    to: 'newdirectory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a directory\'s contents to a new directory using a pattern context', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newdirectory/nestedfile.txt'
                ],
                patterns: [{
                    context: 'directory',
                    from: 'nested',
                    to: 'newdirectory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can flatten a directory\'s contents to a new directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newdirectory/directoryfile.txt',
                    'newdirectory/nestedfile.txt'
                ],
                patterns: [{
                    flatten: true,
                    from: 'directory',
                    to: 'newdirectory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a directory\'s contents to a new directory using an absolute to', (done) => {
            runEmit({
                expectedAssetKeys: [
                    '../tempdir/directoryfile.txt',
                    '../tempdir/nested/nestedfile.txt'
                ],
                patterns: [{
                    from: 'directory',
                    to: TEMP_DIR
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a nested directory\'s contents to the root directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'nestedfile.txt'
                ],
                patterns: [{
                    from: 'directory/nested'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can move a nested directory\'s contents to a new directory', (done) => {
            runEmit({
                expectedAssetKeys: [
                    'newdirectory/nestedfile.txt'
                ],
                patterns: [{
                    from: 'directory/nested',
                    to: 'newdirectory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can use an absolute path to move a nested directory\'s contents to a new directory', (done) => {
            const absolutePath = path.resolve(HELPER_DIR, 'directory', 'nested');

            runEmit({
                expectedAssetKeys: [
                    'newdirectory/nestedfile.txt'
                ],
                patterns: [{
                    from: absolutePath,
                    to: 'newdirectory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('won\'t overwrite a file already in the compilation', (done) => {
            runForce({
                existingAsset: 'directoryfile.txt',
                expectedAssetContent: 'existing',
                patterns: [{
                    from: 'directory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('can force overwrite of a file already in the compilation', (done) => {
            runForce({
                existingAsset: 'directoryfile.txt',
                expectedAssetContent: 'new',
                patterns: [{
                    force: true,
                    from: 'directory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('adds the directory to the watch list', (done) => {
            run({
                patterns: [{
                    from: 'directory'
                }]
            })
            .then((compilation) => {
                const absFrom = path.join(HELPER_DIR, 'directory');

                expect(compilation.contextDependencies).to.have.members([absFrom]);
            })
            .then(done)
            .catch(done);
        });

        it('only include files that have changed', (done) => {
            runChange({
                expectedAssetKeys: [
                    'tempfile1.txt'
                ],
                newFileLoc1: path.join(HELPER_DIR, 'directory', 'tempfile1.txt'),
                newFileLoc2: path.join(HELPER_DIR, 'directory', 'tempfile2.txt'),
                patterns: [{
                    from: 'directory'
                }]
            })
            .then(done)
            .catch(done);
        });

        it('include all files if copyUnmodified is true', (done) => {
            runChange({
                expectedAssetKeys: [
                    'directoryfile.txt',
                    'nested/nestedfile.txt',
                    'tempfile1.txt',
                    'tempfile2.txt'
                ],
                newFileLoc1: path.join(HELPER_DIR, 'directory', 'tempfile1.txt'),
                newFileLoc2: path.join(HELPER_DIR, 'directory', 'tempfile2.txt'),
                options: {
                    copyUnmodified: true
                },
                patterns: [{
                    from: 'directory'
                }]
            })
            .then(done)
            .catch(done);
        });
    });

    describe('options', () => {
        describe('ignore', () => {
            it('ignores files when from is a file', (done) => {
                runEmit({
                    expectedAssetKeys: [
                        'directoryfile.txt'
                    ],
                    options: {
                        ignore: [
                            'file.*'
                        ]
                    },
                    patterns: [{
                        from: 'file.txt'
                    }, {
                        from: 'directory/directoryfile.txt'
                    }]
                })
                .then(done)
                .catch(done);
            });

            it('ignores files when from is a directory', (done) => {
                runEmit({
                    expectedAssetKeys: [
                        'directoryfile.txt'
                    ],
                    options: {
                        ignore: [
                            '*/nestedfile.*'
                        ]
                    },
                    patterns: [{
                        from: 'directory'
                    }]
                })
                .then(done)
                .catch(done);
            });

            it('ignores files with a certain extension', (done) => {
                runEmit({
                    expectedAssetKeys: [],
                    options: {
                        ignore: [
                            '*.txt'
                        ]
                    },
                    patterns: [{
                        from: 'directory'
                    }]
                })
                .then(done)
                .catch(done);
            });

            it('ignores files that start with a dot', (done) => {
                runEmit({
                    expectedAssetKeys: [
                        'file.txt',
                        'directory/directoryfile.txt',
                        'directory/nested/nestedfile.txt'
                    ],
                    options: {
                        ignore: [
                            '.dotted_file'
                        ]
                    },
                    patterns: [{
                        from: '.'
                    }]
                })
                .then(done)
                .catch(done);
            });

            it.skip('ignores all files except those with dots', (done) => {
                runEmit({
                    expectedAssetKeys: [
                        '.dotted_file'
                    ],
                    options: {
                        ignore: [
                            '**/*'
                        ]
                    },
                    patterns: [{
                        from: '.'
                    }]
                })
                .then(done)
                .catch(done);
            });

            it('ignores all files even if they start with a dot', (done) => {
                runEmit({
                    expectedAssetKeys: [],
                    options: {
                        ignore: [{
                            dot: true,
                            glob: '**/*'
                        }]
                    },
                    patterns: [{
                        from: '.'
                    }]

                })
                .then(done)
                .catch(done);
            });
        });
    });
});
