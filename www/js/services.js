'use strict';


var services = angular.module('recess.services', ['firebase']);

services.config(function () {
  // configuration
});

services.service('uuid4', function () {
  /**! http://stackoverflow.com/a/2117523/377392 */
  var fmt = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  this.generate = function () {
    return fmt.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
});

services.factory('_', function ($window) {
  // Helper mixin to sort by keys and not just attributes
  $window._.mixin({
    'sortKeysBy': function (obj, comparator) {
      var keys = _.sortBy(_.keys(obj), function (key) {
        return comparator ? comparator(obj[key], key) : key;
      });

      return _.object(keys, _.map(keys, function (key) {
        return obj[key];
      }));
    }
  });
  return $window._;
});

services.factory('hash', function ($window) {
  return $window.objectHash;
});

services.factory('Permissions', function ($q, $localStorage, Storage) {
  var permissions = $localStorage.permissions;

  var _health = function () {
    var deferred = $q.defer();
    var promise = deferred.promise;

    // is health initialized
    if (navigator.health) {

      navigator.health.isAvailable(function (success) {

        var datatypes = ['steps', 'distance', 'activity'];

        navigator.health.requestAuthorization(datatypes,
          function (authSuccess) {
            permissions.fitness = true;
            Storage.permissions.fitness = true;
            deferred.resolve(authSuccess);

          }, function (authError) {
            console.error(authError);
            permissions.fitness = false;
            Storage.permissions.fitness = false;

            deferred.reject('Health could not grant permissions.');
          });

      }, function (error) {
        console.error(error);
        deferred.reject('Health is not available.');
      });
    } else {
      deferred.reject('Health is not available.');
    }


    promise.success = function (fn) {
      promise.then(fn);
      return promise;
    };

    promise.error = function (fn) {
      promise.then(null, fn);
      return promise;
    };

    return promise;
  };

  return {
    health: _health,
  };
});

services.service('Fitness', function ($q, $moment) {

  // if the service is not available, don't even try
  var cancelService = function () {
    if (navigator.health === undefined) {
      return true;
    }
    return false;
  };

  var _getTotalStepsThisWeek = function (callback) {
    var startDate = $moment.utc().subtract(6, 'days').startOf('day');
    var endDate = $moment.utc().endOf('day');

    getAggregatedData(startDate, endDate, 'steps', 'day').success(function (data) {
      if (data.length == 0) {
        callback();
      } else {
        callback(data);
      }

    }).error(function (error) {
      console.error(error);
    });
  };

  var _getTotalStepsToday = function (callback) {
    //console.log('Get steps today:');

    var startDate = $moment().startOf('day').add(1, 'second');
    var endDate = $moment().endOf('day');

    getAggregatedData(startDate, endDate, 'steps', 'day').success(function (data) {
      if (data.length == 0) {
        callback();
      } else {
        callback(Math.abs(data[0].value));
      }

    }).error(function (error) {
      console.error(error);
    });
  };

  var _getStepsDay = function (day, callback) {
    var startDate = $moment(day).startOf('day');
    var endDate = $moment(day).endOf('day');
    getData(startDate, endDate, 'steps').success(function (data) {
      if (data.length > 0) {
        callback(data);
      } else {
        callback();
      }

    }).error(function (error) {
      console.error('Error retrieving steps: ' + error);
    })
  };

  var _getSteps = function (startDate, endDate, callback) {
    var startDate = $moment(startDate);
    var endDate = $moment(endDate);
    getData(startDate, endDate, 'steps').success(function (data) {
      if (data.length > 0) {
        callback(data);
      } else {
        callback();
      }

    }).error(function (error) {
      console.error('Error retrieving steps: ' + error);
    })
  };

  // convenience method
  var _getStepsToday = function (callback) {
    //console.log('Get steps today:');

    var today = $moment().startOf('day').add(1, 'second'); // day sometimes starts at 23:59:59
    _getStepsDay(today, callback);
  };

  // Activity
  var _getActivityToday = function (callback) {
    //console.log('Get activity today:');

    var startDate = $moment().startOf('day');
    var endDate = $moment().endOf('day');

    getData(startDate, endDate, 'steps').success(function (data) {
      if (data.length > 0) {
        //console.log('data');
        //console.log(data);

        calculateDayActivity(data, function (activityData) {
          callback(activityData);
        });
      } else {
        callback();
      }

    }).error(function (error) {
      console.error(error);
    });

  };

  var _getActiveWeek = function (callback) {
    console.log('Get active week:');

    var activity = {
      days: {},
      total: {
        ms: 0,
        min: 0,
      }
    };

    var daysCollected = 7;

    for (var i = 6; i >= 0; i--) {
      var startDate = $moment().startOf('day').subtract(i, 'days');
      var endDate = $moment().endOf('day').subtract(i, 'days');

      getData(startDate, endDate, 'steps').success(function (data) {
        if (data.length > 0) {
          var day = $moment(data[0].startDate).format('DD.MM.YYYY');
          console.log('Data for day: ' + day);
          console.log(data);

          calculateDayActivity(data, function (activityData) {
            activity.days[day] = activityData;
            activity.total.ms += activityData.total.ms;
            activity.total.min += activityData.total.min;

            // when last Data is reached, return callback
            if (Object.keys(activity.days).length === daysCollected) {
              callback(activity);
            }
          });
        } else {
          daysCollected -= 1;
          // check if we're already ready to send the results or not
          if (Object.keys(activity.days).length === daysCollected) {
            callback(activity);
          }
        }

      }).error(function (error) {
        console.error(error);
      });
    }
  };


  var calculateDayActivity = function (day, callback) {

    var minimumSteps = 10;
    var minimumDurationInMs = 10 * 1000; // 10sec

    var activity = {};

    _.each(day, function (step, i) {
      var start = $moment(step.startDate);
      var end = $moment(step.endDate);
      var difference = end.diff(start);
      var stepcount = step.value;

      //console.log(difference + ': ' + stepcount);
      activity[start.format('H')] = activity[start.format('H')] === undefined ? difference : activity[start.format('H')] + difference;

    });

    var activeDataMs = [];
    var activeDataMin = [];
    var totalMs = 0;
    var totalMin = 0;
    for (var i = 0; i < 24; i++) {
      if (activity[i] !== undefined) {
        var ms = activity[i];
        var min = $moment.duration(ms).minutes();
        totalMs += ms;
        totalMin += min;

        activeDataMs.push(ms);
        activeDataMin.push(min);
      } else {
        activeDataMs.push(0);
        activeDataMin.push(0);
      }

    }

    callback({
      activity: {
        ms: activeDataMs,
        min: activeDataMin,
      },
      total: {
        ms: totalMs,
        min: totalMin
      }
    });
  };

  /**
   * Get data of a specific day
   *
   * @param day
   * @param dataType Type of data
   * @returns Array of steps
   */
  function getData(startDate, endDate, dataType) {
    var deferred = $q.defer();
    var promise = deferred.promise;

    if (cancelService()) {
      deferred.reject('Health is not available.');
    } else {
      /*
       console.log('Fitness Data:' + dataType
       + ' startDate: ' + $moment(startDate).format('DD.MM.YYYY HH:mm')
       + ' endDate: ' + $moment(endDate).format('DD.MM.YYYY HH:mm')
       );
       */
      // Query health
      navigator.health.query({
        startDate: $moment(startDate).toDate(),
        endDate: $moment(endDate).toDate(),
        dataType: dataType,
      }, function (results) {
        deferred.resolve(results);
      }, function (error) {
        console.error(error);
        deferred.reject(error);
      });

    }

    promise.success = function (fn) {
      promise.then(fn);
      return promise;
    };

    promise.error = function (fn) {
      promise.then(null, fn);
      return promise;
    };

    return promise;
  }

  function getAggregatedData(startDate, endDate, dataType, bucket) {
    var deferred = $q.defer();
    var promise = deferred.promise;
    if (cancelService()) {
      deferred.reject('Health is not available.');
    } else {

      //console.log('start: ' + startDate.toDate());
      //console.log('end: ' + endDate.toDate());

      // Query health for aggregated data
      navigator.health.queryAggregated({
        startDate: startDate.toDate(),
        endDate: endDate.toDate(),
        dataType: dataType,
        bucket: bucket,
      }, function (results) {
        //console.log('Aggregated Data:');
        //console.log(results);
        deferred.resolve(results);
      }, function (error) {
        console.error(error);
        deferred.reject(error);
      });
    }

    promise.success = function (fn) {
      promise.then(fn);
      return promise;
    };

    promise.error = function (fn) {
      promise.then(null, fn);
      return promise;
    };

    return promise;
  }

  return {
    getTotalStepsThisWeek: _getTotalStepsThisWeek,
    getTotalStepsToday: _getTotalStepsToday,
    getStepsToday: _getStepsToday,
    getStepsDay: _getStepsDay,
    getSteps: _getSteps,

    // Activity
    getActivityToday: _getActivityToday,
    getActiveWeek: _getActiveWeek,

  };
});

services.service('Storage', function (_, $localStorage, $moment, hash,
                                      $firebaseAuth, $firebaseObject, $firebaseArray) {

  console.log('Storage called');

  var _getBaseRef = function () {
    // assuming a valid userid exists in local storage
    var user = $localStorage.user;
    return firebase.database().ref().child('users').child(user.uid);
  };

  var _user = function () {
    var ref = _getBaseRef().child('user');
    return $firebaseObject(ref);
  };

  var _permissions = function () {
    return returnArray('permissions');
  };

  var _config = function () {
    return returnArray('config');
  };

  var _configLast = function () {
    return returnLastFromArray('config');
  };

  var _sync = function () {
    return returnArray('config/sync');
  };

  var _syncLast = function () {
    return returnLastFromArray('config/sync');
  };

  // Steps
  var _steps = function () {
    return returnArray('steps');
  };

  var _stepsLast = function () {
    return returnLastFromArray('steps');
  };

  var _stepsAdd = function (step) {

    // clean data
    _.each(step, function (attribute, key) {

      // firebase does not support date times, therefore convert it to JSON
      if (key.includes('Date')) {
        step[key] = $moment(attribute).toJSON();
      }
    });

    // console.log(step);

    var ref = _getBaseRef().child('steps').child($moment(step.startDate).format('YYYY-MM-DD'));
    var id = objectHash.sha1(step);

    ref.child(id).set(step);
  };

  // Goals
  var _goals = function () {
    return returnArray('goals');
  };

  var _goalsLast = function () {
    return returnLastFromArray('goals');
  };

  var _goalsLastItem = function () {
    return returnLastItemFromArray('goals');
  };

  var _goalsAdd = function (goal) {

    // clean data
    // firebase does not support date times, therefore convert it to JSON
    if (key.includes('Date')) {
      goal[key] = $moment(attribute).toJSON();
    }

    // console.log(step);
    var ref = _getBaseRef().child('goals').child($moment(step.startDate).format('YYYY-MM-DD'));
    var id = objectHash.sha1(goal);

    ref.child(id).set(goal);
  };


  // Helper functions to get references
  function returnArray(node) {
    var ref = _getBaseRef().child(node);
    return $firebaseArray(ref);
  }

  function returnLastFromArray(node) {
    var ref = _getBaseRef().child(node).limitToLast(1);
    return $firebaseArray(ref);
  }

  function returnLastItemFromArray(node) {
    var ref = _getBaseRef().child(node).limitToLast(1);
    $firebaseArray(ref).$loaded(function (list) {
      var itemId = list[0].$id;
      return array.$getRecord(itemId);
    });

  }


  return {
    user: _user,
    permissions: _permissions,
    config: {
      all: _config,
      last: _configLast,
      sync: {
        all: _sync,
        last: _syncLast,
      }
    },
    steps: {
      all: _steps,
      last: _stepsLast,
      $add: _stepsAdd,
      // days: _days,
      // day: _day,
    },
    goals: {
      all: _goals,
      last: _goalsLast,
      lastItem: _goalsLastItem,
      $add2: _goalsAdd
    }
  }

});

services.factory('Authentication', function ($q, $firebaseAuth, uuid4, $timeout, $localStorage, Storage) {
  var _self = this;
  var authRetries = 3;

  // Initialize user immediately
  _self._init = function () {
    console.log('init');
    var deferred = $q.defer();
    var promise = deferred.promise;

    var localstorageUser = $localStorage.user;

    if (localstorageUser === undefined) {
      // create a new user
      var email = uuid4.generate() + '@doesnot.exist';
      var password = 'mydirtylittlesecret-' + uuid4.generate();
      console.log(email);
      console.log(password);

      $firebaseAuth().$createUserWithEmailAndPassword(email, password).then(function (firebaseUser) {
        console.log('User created with uid: ' + firebaseUser.uid);

        var userObject = {
          email: email,
          password: password,
          uid: firebaseUser.uid,
          date: firebase.database.ServerValue.TIMESTAMP,
        };

        // store in localstorage
        localstorageUser = $localStorage;
        localstorageUser.user = userObject;

        // persist credentials for re-use
        var user = Storage.user();

        // store in firebase
        user.$value = userObject;
        user.$save();

        // init with default value
        var goals = Storage.goals.last().$loaded().then(function (goal) {
          console.log('last goal: ');
          console.log(goal);

          // initialize with default value
          if (goal[0] === undefined) {
            goals = Storage.goals.all();
            goals.$add({
              steps: 10000,
              active: 200,
            });

            goals = Storage.goals.last();
          }
        });


        deferred.resolve(true);

      }).catch(function (error) {
        console.error(error);
        deferred.reject();
      });

    } else {
      // authenticate
      $firebaseAuth().$signInWithEmailAndPassword(localstorageUser.email,
        localstorageUser.password).then(function (authData) {

        console.log("Logged in as:", authData.uid);

      }).catch(function (error) {
        // something went wrong
        if (error.code === 'auth/user-not-found' || error.message === 'USER_NOT_FOUND') {
          console.error('User has been deleted.'); // most likely
          delete $localStorage.user;
          _self._init();
        } else {
          console.error('Authentication failed:', error);
          deferred.reject();
        }

      });
    }

    promise.success = function (fn) {
      promise.then(fn);
      return promise;
    };

    promise.error = function (fn) {
      promise.then(null, fn);
      return promise;
    };

    return promise;
  }();

  _self.isAuthenticated = function () {
    var deferred = $q.defer();
    var promise = deferred.promise;

    var authenticated = $firebaseAuth().$getAuth();
    console.log(authenticated);
    if (authenticated !== undefined && authenticated !== null) {
      deferred.resolve(true);
    } else {
      deferred.resolve(false);
    }

    promise.success = function (fn) {
      promise.then(fn);
      return promise;
    };

    promise.error = function (fn) {
      promise.then(null, fn);
      return promise;
    };

    return promise;

  };

  _self._user = function () {
    console.log('calling user');
    _self.isAuthenticated().success(function (isAuthenticated) {
      if (isAuthenticated) {
        var ref = firebase.database().ref().child('user');
        var user = $firebaseObject(ref);
        return user;

      } else if (authRetries > 0) {
        $timeout(function () {
          return _self._user();
        }, 2000);

      } else {
        console.error('Attempted maximum retries to authenticate. Giving up now.');
      }

    }).error(function () {
      console.error('User not authenticated yet.');
    });
  };


  return {
    isAuthenticated: _self._user,
  }

});

services.service('Configurator', function () {

});

services.service('Collector', function (Storage, Fitness, $moment, $timeout) {
  var _self = this;
  var lastSync = $moment().startOf('day').subtract(14, 'days');
  var intervalInMs = 2000;
  var timesCollected = 0;

  _self.collect = function () {
    Storage.config.sync.last().$loaded().then(function (last) {
      console.log('last: ' + last);
      // initialize with default value
      if (last[0] === undefined) {
        Storage.config.sync.all().$add(lastSync.toJSON());
      } else {
        lastSync = $moment(last[0].$value);
      }
      console.log(lastSync.format('DD.MM.YYYY'));

      _self.timeout = $timeout(function () {
        Fitness.getStepsDay(lastSync, function (steps) {
          if (steps !== undefined) { // no data available
            _.each(steps, function (step) {
              var startDate = $moment(step.startDate);
              var endDate = $moment(step.endDate);
              var duration = endDate.diff(startDate);

              step.duration = duration;
              Storage.steps.$add(step);
            });
          } else {
            console.log('Date: ' + lastSync.format('DD.MM.YYYY') + ' #: ' + timesCollected++ + ' # steps: ' + steps.length);
          }
          console.log('Date: ' + lastSync.format('DD.MM.YYYY') + ' #: ' + timesCollected++);
        });


        if (!lastSync.isSame($moment(), 'day')) {
          Storage.config.sync.all().$add(lastSync.add(1, 'days').toJSON());
          intervalInMs = 0;
          _self.collect();
        } else {
          console.log('reached today, stop collecting.');
        }

      }, intervalInMs);

    });

  };

  _self.collect();

});

