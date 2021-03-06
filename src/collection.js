var path = require('path')
var Repository = require('./repository')
var fs = require('fs')
var Promise = require('promise')
var mkdirp = require('mkdirp')

var write = Promise.denodeify(fs.writeFile)
var read = Promise.denodeify(fs.readFile)

module.exports = function(options) {
  var root = options.path
  var user = options.user || '_default'
  var email = options.email || user + '@vetus'
  var branch = options.branch || 'master'

  var bareroot = path.join(root, '_bare')
  var userroot = path.join(root, user)

  var barerepo = new Repository(bareroot)
  var repo = new Repository(userroot)
  var barerepoInit

  var data = {}

  var load = function(callback) {
    createUserDirectory(function() {
      checkUserGit(function() {
        changeBranch(branch, function(branchExists) {
          if (branchExists) {
            repo.pull('origin ' + branch, function() {
              fs.readdir(userroot, function(err, filenames) {
                if (err) {
                  console.log(err)
                  return
                }

                var promises = filenames
                  .filter(f => f.endsWith('.json'))
                  .map(f => new Promise(function(done, error) {

                    fs.readFile(path.join(userroot, f), 'utf-8', function(err, file) {

                      if (err) {
                        error(err)
                      } else {
                        var obj = JSON.parse(file)
                        data[f.replace('.json', '')] = obj
                        done()
                      }
                    })
                  }))

                Promise.all(promises).then(function() {
                  callback()
                })
              })
            })
          } else {
            console.log("ERROR: Branch does not exist - use createBranch")
            callback()
          }
        })
      })
    })
  }

  var save = function(message, callback) {
    createDirectory(function() {
      createUserDirectory(function() {
        checkBareGit(function() {
          checkUserGit(function(userExists) {
            var promises = Object.getOwnPropertyNames(collection.data)
              .map(p => write(path.join(userroot, p + '.json'), JSON.stringify(collection.data[p], null, 2)))

            Promise.all(promises).then(function() {
              if (!barerepoInit) {
                repo.status(function(status) {
                  if (status) {
                    console.log("WARNING: Initial push forced to origin master")
                    addAndCommit(message, function() {
                      repo.push(" origin master", function() {
                        barerepoInit = true
                        callback()
                      })
                    })
                  } else {
                    console.log("WARNING: Empty save - Repo not initialised!")
                    callback()
                  }
                })
              } else {
                //console.log("Saving to branch " + branch)
                changeBranch(branch, function(){
                  addAndCommit(message, function() {
                    repo.push(" origin " + branch, function() {
                      callback()
                    })
                  })
                })
              }
            })
          })
        })
      })
    })
  }

  var merge = function(fromBranch, callback) {
    repo.checkout(branch, function() {
      repo.merge(fromBranch, function(output, err) {
        if (err) {
          repo.merge(" --abort", function() {
            console.log("Merge conflict : ")
            console.log(output)
            resolveConflict(fromBranch)
          })
          callback(err)
        } else {
          callback()
        }
      })
    })
  }

  var createBranch = function(newbranch, callback) {
    repo.branchExists(newbranch, function(branchExists){
      if (!branchExists) {
        repo.checkout(branch, function() {
          repo.branch(newbranch, function() {
            repo.checkout(newbranch, function() {
              repo.push(" origin " + newbranch, function() {
                console.log("Branch created & pushed to origin")
                callback()
              })
            })
          })
        })
      } else {
        console.log("ERROR: Branch already exists")
        callback()
      }
    })
  }

  var resolveConflict = function(mergeToBranch, callback) {
    repo.mergeBase(branch, mergeToBranch, function(base) {
      var baseObj, leftObj, rightObj
      branchToObj(base, function(baseObj) {
        baseObj = baseObj
        branchToObj(branch, function(leftObj) {
          leftObj = leftObj
          branchToObj(mergeToBranch, function(rightObj) {
            rightObj = rightObj
            // diff(baseObj, leftObj, rightObj, function() {
            //   callback()
            // })
          })
        })
      })
    })
  }

  var branchToObj = function(currentbranch, callback) {
    repo.checkout(currentbranch, function() {
      var localdata = {}
      fs.readdir(userroot, function(err, filenames) {
        if (err) {
          console.log(err)
          return
        }

        var promises = filenames
          .filter(f => f.endsWith('.json'))
          .map(f => new Promise(function(done, error) {

            fs.readFile(path.join(userroot, f), 'utf-8', function(err, file) {

              if (err) {
                error(err)
              } else {
                var obj = JSON.parse(file)
                localdata[f.replace('.json', '')] = obj
                done()
              }
            })
          }))

        Promise.all(promises).then(function() {
          callback(localdata)
        })
      })
    })
  }

  var getHistory = function(logOptions, callback) {
    repo.jsonLog(logOptions + ' ' + branch, function(result) {
      //console.log(result)
      callback(result)
    })
  }

  var changeBranch = function(newbranch, callback) {
    repo.branchExists(newbranch, function(branchExists){
      if (branchExists) {
        repo.checkout(newbranch, function() {
          callback(branchExists)
        })
      } else {
        console.log("ERROR: Branch does not exist - use createBranch")
      }
    })
  }

  var checkBareGit = function(callback) {
    baregitExists(bareroot, function(bareExists) {
      if (!bareExists) {
        barerepo.initBare(function() {
          callback()
        })
      } else {
        callback()
      }
    })
  }

  var addAndCommit = function(message, callback) {
    repo.status(function(status){
      if (status){
        repo.addAll(function() {
          repo.commit(message, callback)
        })
      }
      else {
        callback()
      }
    })
  }

  var checkUserGit = function(callback) {
    gitExists(userroot, function(userExists) {
      if (!userExists) {
        repo.clone(bareroot ,function() {
          repo.config('user.name "' + user + '"', function() {
            repo.config('user.email ' + email, function() {
              callback(userExists)
            })
          })
        })
      } else {
        callback(userExists)
      }
    })
  }

  var gitExists = function(gitroot, callback) {
    fs.lstat(path.join(gitroot, '.git'), function(lstatErr, stats) {
      if (lstatErr) {
        callback(false)
        return
      }

      callback(stats.isDirectory())
    })
  }

  var baregitExists = function(gitroot, callback) {
    fs.lstat(path.join(gitroot, 'info'), function(lstatErr, stats) {
      if (lstatErr) {
        callback(false)
        return
      }

      callback(stats.isDirectory())
    })
  }

  baregitExists(bareroot, function(result){
    barerepoInit = result
  })

  var createDirectory = function(callback) {
    fs.lstat(bareroot, function(err, stats) {

      if (!stats || !stats.isDirectory()) {
        mkdirp(bareroot, function() {
          callback()
        })
      } else {
        callback()
      }
    })
  }

  var createUserDirectory = function(callback) {
    fs.lstat(userroot, function(err, stats) {

      if (!stats || !stats.isDirectory()) {
        mkdirp(userroot, function() {
          callback()
        })
      } else {
        callback()
      }
    })
  }

  var branchList = function(callback) {
    repo.fetch(function() {
      repo.branchList(function(list) {
        var items = list.split('\n')

        var items = items
          .filter(b => b !== '')
          .map(b => {
          if (b.startsWith('* ')) {
            b = b.replace('* ', '')
          }

          if (b.startsWith('  ')) {
            b = b.substring(2)
          }

          if (b.startsWith('remotes/origin/')) {
            b = b.replace('remotes/origin/', '')
          }

          return b
        })
        .filter(b => !b.startsWith('HEAD'))

        callback(arrayUnique(items))
      })
    })
  }

  var arrayUnique = function(a) {
      return a.reduce(function(p, c) {
          if (p.indexOf(c) < 0) p.push(c)
          return p
      }, [])
  }

  var collection = {
    data: data,
    load: load,
    save: save,
    createBranch: createBranch,
    merge: merge,
    getHistory: getHistory,
    branchList: branchList
  }

  return collection
}
