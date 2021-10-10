'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');
const fs = require('fs');
const path = require('path');
const isGlob = require('is-glob');
const globToRegExp = require('glob-to-regexp');

const Executor = require('@runnerty/module-core').Executor;

class blobExecutor extends Executor {
  constructor(process) {
    super(process);
  }
    
    exec(params) {
        if (!params.blobContainer) {
        const endOptions = {
            end: 'error',
            messageLog: 'Blob container is not defined.',
            err_output: 'Blob container is not defined.'
        };
        this.end(endOptions);
        } 

        switch (params.method) {
        case 'upload':
            this.upload(params);
            break;
        case 'delete':
            this.delete(params);
            break;
        case 'download':
            this.download(params);
            break;
        default:
            const endOptions = {
            end: 'error',
            messageLog: `Blob method not accepted: ${params.method}`,
            err_output: `Blob method not accepted: ${params.method}`
            };
            this.end(endOptions);
        }
    }

    async upload(params) {
        var bindingError = false;
        let blobServiceClient;
        let containerClient;
        let blockBlobClient;

        try {
            blobServiceClient = BlobServiceClient.fromConnectionString(params.connectionString);
            containerClient = blobServiceClient.getContainerClient(params.blobContainer);
            blockBlobClient = containerClient.getBlockBlobClient(params.remote_file);
        } catch(ex) {
            bindingError = true;
            const endOptions = {
                end: 'error',
                messageLog: `Uploading blob binding Error: ${ex.message}`,
                err_output: `Uploading blob binding Error: ${ex.message}`
            };
            this.end(endOptions);
        }

        if (!bindingError) {
            const uploadBlobResponse = blockBlobClient.uploadFile(params.local_file).
            then(() => {
                const endOptions = {
                    end: 'end',
                    data_output: uploadBlobResponse.requestId
                };
                this.end(endOptions);
            }).
            catch((ex) => {
                const endOptions = {
                    end: 'error',
                    messageLog: `Blob upload file Error: ${ex.message}`,
                    err_output: `Blob upload file Error: ${ex.message}`
                };
                this.end(endOptions);
            });
        }
    }

    async delete(params) {
        var bindingError = false;
        var globError = false;
        var dirName = '';
        let blobServiceClient;
        let containerClient;

        try {
            blobServiceClient = BlobServiceClient.fromConnectionString(params.connectionString);
            containerClient = blobServiceClient.getContainerClient(params.blobContainer);
        } catch(ex) {
            bindingError = true;
            const endOptions = {
                end: 'error',
                messageLog: `Deleting blob binding Error: ${ex.message}`,
                err_output: `Deleting blob binding Error: ${ex.message}`
            };
            this.end(endOptions);
        }
        if (!bindingError) {
            // Check Glob, if exists set dirName
            if (isGlob(params.remote_path.toString())) { // String or Array
                dirName = path.dirname(params.remote_path);

                if (isGlob(dirName)) {
                    const endOptions = {
                    end: 'error',
                    messageLog: 'Glob only applicable to filenames.',
                    err_output: 'Glob only applicable to filenames.'
                    };
                    this.end(endOptions);
                } else {   
                    // Get files from dirName:
                    let patternGlob;
                    let valRegExp;
                    let matchFiles;
                    try {
                        patternGlob = path.basename(params.remote_path);
                        valRegExp = globToRegExp(patternGlob);
                        matchFiles = [];
                    } catch(ex) {
                        globError = true;
                        const endOptions = {
                            end: 'error',
                            messageLog: `Deleting glob pattern Error. Discrepancies with remote path found: ${ex.message}`,
                            err_output: `Deleting glob pattern Error. Discrepancies with remote path found: ${ex.message}`
                        };
                        this.end(endOptions);
                    }

                    if (!globError) {
                        try {
                            for await (const blob of containerClient.listBlobsByHierarchy('/', {prefix: `${dirName}/`})) {
                                if (blob.kind === 'blob' && valRegExp.test(path.basename(blob.name))) { // Blobs, not preffix
                                    matchFiles.push(blob.name)
                                }
                            }
                        } catch(ex) {
                            const endOptions = {
                                end: 'error',
                                messageLog: `Blob delete. Error accessing blob: ${ex.message}`,
                                err_output: `Blob delete. Error accessing blob: ${ex.message}`
                            };
                            this.end(endOptions);
                        }
                        this.deleteBlobAsync(containerClient, matchFiles).
                        then(() => {
                            const endOptions = {
                                end: 'end'
                            };
                            this.end(endOptions);
                        }).
                        catch((ex) => {
                            const endOptions = {
                                end: 'error',
                                messageLog: `Blob delete Error: ${ex.message}`,
                                err_output: `Blob delete Error: ${ex.message}`
                            };
                            this.end(endOptions);
                        });
                    }
                }
            } else { // Single or Array of blobs
                this.deleteBlobAsync(containerClient, params.remote_path).
                then(() => {
                    const endOptions = {
                        end: 'end'
                    };
                    this.end(endOptions);
                }).
                catch((ex) => {
                    const endOptions = {
                        end: 'error',
                        messageLog: `Blob delete Error: ${ex.message}`,
                        err_output: `Blob delete Error: ${ex.message}`
                    };
                    this.end(endOptions);
                });
            }
        }
    }

    async deleteBlobAsync(blobContainerClient, files) {
        return new Promise(async (resolve, reject) => {
            if (files.constructor !== Array) {
                files = [files];
            }
    
            if (files.length) {
                await Promise.all(
                    files.map(async file => {
                        const blockBlobClient = blobContainerClient.getBlockBlobClient(file);
                        await blockBlobClient.delete();    
                    })
                ).then(() => resolve()).catch((err) => reject(err));
            } else {
                resolve();
            }    
        })
    }

    async download(params) {
        var bindingError = false;
        let blobServiceClient;
        let containerClient;
        let blockBlobClient;

        const pathWOFile = path.dirname(params.local_file);
        var createPathIfNotExists = function(pth){
            if (!fs.existsSync(pth)) {
                fs.mkdirSync(pth, { recursive: true });
            }
        }
        createPathIfNotExists(pathWOFile);

        try {    
            blobServiceClient = BlobServiceClient.fromConnectionString(params.connectionString);
            containerClient = blobServiceClient.getContainerClient(params.blobContainer);
            blockBlobClient = containerClient.getBlockBlobClient(params.remote_file);
        } catch(ex) {
            bindingError = true;
            const endOptions = {
                end: 'error',
                messageLog: `Downloading blob binding Error: ${ex.message}`,
                err_output: `Downloading blob binding Error: ${ex.message}`
            };
            this.end(endOptions);
        }

        if (!bindingError) {
            const downloadBlobResponse = blockBlobClient.downloadToFile(params.local_file).
            then(() => {
                const endOptions = {
                    end: 'end'
                };
                this.end(endOptions);
            }).
            catch((ex) => {
                const endOptions = {
                    end: 'error',
                    messageLog: `Blob download file Error: ${ex.message}`,
                    err_output: `Blob download file Error: ${ex.message}`
                };
                this.end(endOptions);
            });
        }
    }
}

module.exports = blobExecutor;