/*
firetable.js
firetable API wrapper
*/

var ftapi = {
  started: false,
  loggedIn: false,
  banned: false,
  isMod: false,
  presenceDetectRef: null,
  presenceDetectEvent: null,
  blockEvent: null,
  blockRef: null,
  nameChangeAfterSignUp: null,
  pendingSignUpName: null, // set while a new email account's username is being saved
  chatEvent: null,
  chatChangedEvent: null,
  connectedRef: null,
  superCopBanUpdates: null,
  uname: null,
  uid: null,
  selectedListThing: "0",
  queueBind: null,
  queueRef: null,
  queue: null,
  users: {},
  blockedUsers: {}
};

/** The room's Realtime Database (the "firetable" Firebase app). */
ftapi.db = function() {
  return firebase.app("firetable").database();
};

/** Server clock minus this device's clock, in ms (kept current from .info/serverTimeOffset). */
ftapi.serverTimeOffset = 0;

/**
 * Current time on the server's clock, in ms. Use this (not Date.now()) when
 * comparing against server timestamps like song.started or chat time.
 * @returns {number}
 */
ftapi.now = function() {
  return Date.now() + ftapi.serverTimeOffset;
};

/**
 * Stop everything tied to the signed-in user (presence, ban check, blocks,
 * playlist, supermod ban list), so logging out and back in — even as someone
 * else — never leaves old listeners running or stacks duplicates. The chat
 * feed stays: it's the room's, and its history is kept on screen.
 */
ftapi.detachSession = function() {
  var pairs = [
    ["connectedRef", "connectedEvent"],
    ["banRef", "banEvent"],
    ["blockRef", "blockEvent"],
    ["queueRef", "queueBind"],
    ["superCopRef", "superCopBanUpdates"]
  ];
  pairs.forEach(function(p) {
    if (ftapi[p[0]] && ftapi[p[1]]) ftapi[p[0]].off("value", ftapi[p[1]]);
    ftapi[p[1]] = null;
  });
  if (ftapi.presenceDetectRef) {
    ftapi.presenceDetectRef.onDisconnect().cancel();
    ftapi.presenceDetectRef = null;
  }
  ftapi.isMod = false;
  ftapi.banned = false;
  ftapi.blockedUsers = {};
};

/*
RECENT AND FRESH
Each is about a hundred tracks, so they download the first time their tab
opens (or something else needs them), not on every page load. After that
they stay live.
*/
ftapi.historyLoaded = 0;
ftapi.feeds = {
  // the latest plays only; older ones load on request (ftapi.lookup.olderHistory)
  history: {
    query: function() { return ftapi.db().ref("songHistory").limitToLast(HISTORY_PAGE_SIZE); },
    bind: function(query) {
      query.on('child_added', function(dataSnapshot) {
        var data = dataSnapshot.val();
        data.histID = dataSnapshot.key;
        if (!ftapi.oldestHistoryKey || dataSnapshot.key < ftapi.oldestHistoryKey) ftapi.oldestHistoryKey = dataSnapshot.key;
        ftapi.historyLoaded++;
        ftapi.events.emit("newHistory", data);
      });
      query.on('child_changed', function(dataSnapshot) {
        var data = dataSnapshot.val();
        data.histID = dataSnapshot.key;
        ftapi.events.emit("editedHistory", data);
      });
    }
  },
  fresh: {
    query: function() { return ftapi.db().ref("newMusic"); },
    bind: function(query) {
      query.on('child_added', function(dataSnapshot) {
        var data = dataSnapshot.val();
        data.histID = dataSnapshot.key;
        ftapi.events.emit("newProduce", data);
      });
    }
  }
};

/**
 * Start Recent ("history") or Fresh ("fresh"), once.
 * @param {string} name
 * @returns {Promise} resolves when its tracks have arrived
 */
ftapi.watchFeed = function(name) {
  var feed = ftapi.feeds[name];
  if (!feed) return Promise.resolve();
  if (feed.ready) return feed.ready;
  if (!ftapi.started) {
    // asked for before Firebase started: ftapi.init starts it
    feed.wanted = true;
    return new Promise(function(resolve) {
      (feed.waiting = feed.waiting || []).push(resolve);
    });
  }
  var query = feed.query();
  feed.bind(query);
  // the same query, so this is answered from what the listeners downloaded
  feed.ready = query.once('value').then(function() {}, function() {});
  (feed.waiting || []).forEach(function(resolve) { feed.ready.then(resolve); });
  feed.waiting = null;
  return feed.ready;
};

/** True once Recent or Fresh has been started. */
ftapi.feedStarted = function(name) {
  return !!(ftapi.feeds[name] && ftapi.feeds[name].ready);
};

ftapi.ready = function() {
  ftapi.events = new EventEmitter();
};

ftapi.init = function(firebaseConfig) {
  console.log("Powered by firetable. \n" +
    "For more information, head to firetable.org");
  ftapi.started = true;

  // init firebase app
  firebase.initializeApp(firebaseConfig, "firetable");

  // Track how far this device's clock is from Firebase's, so song positions
  // and timers don't drift on devices whose clock is off.
  ftapi.db().ref(".info/serverTimeOffset").on("value", function(snap) {
    ftapi.serverTimeOffset = Number(snap.val()) || 0;
  });


  /*
  NON-AUTHENTICATED FIRETABLE EVENT BINDINGS
  All realtime events for the non-authenticated user
  These will persist regardless of auth state changes
  */
  // users change event emitter
  var ref2 = ftapi.db().ref("users");
  ref2.orderByChild('status').equalTo(true).on('child_added', function(dataSnapshot) {
    var okdata = dataSnapshot.val();
    okdata.userid = dataSnapshot.key;
    if (ftapi.blockedUsers[okdata.userid]) {
      okdata.blocked = true;
    }
    ftapi.events.emit("userJoined", okdata);
  });
  ref2.orderByChild('status').equalTo(true).on('child_removed', function(dataSnapshot) {
    var okdata = dataSnapshot.val();
    okdata.userid = dataSnapshot.key;
    if (ftapi.blockedUsers[okdata.userid]) {
      okdata.blocked = true;
    }
    ftapi.events.emit("userLeft", okdata);
  });
  ref2.orderByChild('status').equalTo(true).on('child_changed', function(dataSnapshot) {
    var okdata = dataSnapshot.val();
    okdata.userid = dataSnapshot.key;
    if (ftapi.blockedUsers[okdata.userid]) {
      okdata.blocked = true;
    }
    ftapi.events.emit("userChanged", okdata);
  });
  ref2.orderByChild('status').equalTo(true).on('value', function(dataSnapshot) {
    var okdata = dataSnapshot.val();
    for (var key in okdata) {
      if (ftapi.blockedUsers[key]) {
        okdata[key].blocked = true;
      }
    }
    // No one online => Firebase returns null; keep users an object (as it
    // starts out) so lookups like ftapi.users[id] don't throw.
    ftapi.users = okdata || {};
    if (window.firetable && firetable.utilities && firetable.utilities.trackNames) {
      firetable.utilities.trackNames(ftapi.users);
    }
    if (ftapi.users[ftapi.uid]) {
      if (ftapi.users[ftapi.uid].username) {
        ftapi.uname = ftapi.users[ftapi.uid].username;
      }
    }
    ftapi.events.emit("usersChanged", okdata);
    if (ftapi.uid) {
      if (!ftapi.users[ftapi.uid]) {
        //Firebase thinks you are not here (but you are totally here!)
        ftapi.presenceDetectRef = ftapi.db().ref("users/" + ftapi.uid + "/status");
        ftapi.presenceDetectEvent = ftapi.presenceDetectRef.onDisconnect().set(false);
        ftapi.presenceDetectRef.set(true);
      } else {
        if (ftapi.users[ftapi.uid].supermod) {
          if (!ftapi.superCopBanUpdates) {
            //begin event listener for ban updates
            ftapi.superCopRef = ftapi.db().ref("banned");
            ftapi.superCopBanUpdates = ftapi.superCopRef.on('value', function(dataSnapshot) {
              ftapi.events.emit("banListChanged", dataSnapshot.val());
            });
          }
        }
      }
    }
  });

  // new song event emitter
  var s2p = ftapi.db().ref("songToPlay");
  s2p.on('value', function(dataSnapshot) {
    var songData = dataSnapshot.val();
    ftapi.events.emit("newSong", songData);
  });

  // song tempo emitter (the bot looks it up after a song starts)
  ftapi.db().ref("songBpm").on('value', function(dataSnapshot) {
    ftapi.events.emit("songBpm", dataSnapshot.val());
  });

  // song tag update emitter
  var tagUpdate = ftapi.db().ref("tagUpdate");
  tagUpdate.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    if (!data) return;
    ftapi.events.emit("tagUpdate", data);
  });

  // Recent and Fresh load when first needed (ftapi.watchFeed), not here
  Object.keys(ftapi.feeds).forEach(function(name) {
    if (ftapi.feeds[name].wanted) ftapi.watchFeed(name);
  });


  // table change emitter
  var tbl = ftapi.db().ref("table");
  tbl.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("tableChanged", data);
  });

  // spotlight state changed emitter
  var pldx = ftapi.db().ref("playdex");
  pldx.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("spotlightStateChanged", data);
  });

  // playlimit change emitter
  var plc = ftapi.db().ref("playlimit");
  plc.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("playLimitChanged", data);
  });

  // waitlist change emitter
  var wl = ftapi.db().ref("waitlist");
  wl.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("waitlistChanged", data);
  });

  // new theme emitter
  var themeChange = ftapi.db().ref("theme");
  themeChange.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("newTheme", data);
  });

  // dance state emitter
  var danceCheck = ftapi.db().ref("dance");
  danceCheck.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("danceStateChanged", data);
  });

  // festive lights emitter
  var lightsCheck = ftapi.db().ref("lights");
  lightsCheck.on('value', function(dataSnapshot) {
    ftapi.events.emit("lightsChanged", dataSnapshot.val());
  });

  // screen sync change emitter
  var thescreen = ftapi.db().ref("thescreen");
  thescreen.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("screenStateChanged", data);
  });

  var colors = ftapi.db().ref("colors");
  colors.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("colorsChanged", data);
  });

  /*
  AUTHENTICATED FIRETABLE EVENT BINDINGS
  Realtime events for the authenticated user
  */
  firebase.app("firetable").auth().onAuthStateChanged(function(user) {
    if (!ftapi.loggedIn) {
      // YOU ARE NOT LOGGED IN YET. IF AUTHENTICATED, INIT LOGIN
      if (user) {
        ftapi.loggedIn = true; // this stays true until the logout function is called
        ftapi.detachSession(); // in case an earlier session left anything behind
        // Set the uid first: .info/connected is usually known already, so its
        // first event can fire right away and must see who is signed in.
        ftapi.uid = user.uid;
        ftapi.uname = user.uid;
        ftapi.connectedRef = ftapi.db().ref('.info/connected');
        ftapi.connectedEvent = ftapi.connectedRef.on('value', function(snap) {
          if (snap.val() === true && ftapi.uid) {
            ftapi.presenceDetectRef = ftapi.db().ref("users/" + ftapi.uid + "/status");
            ftapi.presenceDetectEvent = ftapi.presenceDetectRef.onDisconnect().set(false);
            ftapi.presenceDetectRef.set(true);
          }
        });
        var returnData = {
          email: user.email,
          uid: user.uid
        };
        ftapi.lookup.userByID(user.uid, function(data) {
          if (data) {
            returnData.user = data;
            if (data.username) ftapi.uname = data.username;
            if (data.avatarStyle) {
              firetable.avatarStyle = data.avatarStyle;
              localStorage[STORAGE.avatarStyle] = data.avatarStyle;
            }
            if (data.mod || data.supermod) {
              ftapi.isMod = true;
              ftapi.events.emit("modCheck", true);
            }
          }

          ftapi.events.emit("loggedIn", returnData);
        });

        ftapi._lastIdleState = null; // always write the first status of a session
        ftapi.actions.changeIdleStatus(false, 1);

        // setup ban check event emitters
        ftapi.banRef = ftapi.db().ref("banned/" + ftapi.uid);
        ftapi.banEvent = ftapi.banRef.on('value', function(dataSnapshot) {
          var data = dataSnapshot.val();
          if (data) {
            if (!ftapi.banned) {
              ftapi.banned = true;
              var ref0 = ftapi.db().ref("users/" + ftapi.uid + "/status");
              ftapi.uid = null;
              ref0.set(false);
              ftapi.events.emit("userBanned");
            }
          } else if (ftapi.banned) {
            ftapi.events.emit("userUnbanned");
          }
        });

        // chat event emitter
        if (!ftapi.chatEvent) {
          // Only the latest messages; the chat shows a limited history anyway
          var chatRef = ftapi.db().ref("chatFeed").limitToLast(CHAT_HISTORY_LIMIT);
          var chatChain = Promise.resolve();
          ftapi.chatEvent = chatRef.on('child_added', function(childSnapshot) {
            var feedData = childSnapshot.val() || {};
            var chatID = feedData.chatID;
            // Fetch messages in parallel, but show them strictly in feed order
            var lookup = ftapi.lookup.chatData(chatID);
            chatChain = chatChain.then(function() { return lookup; }).then(function(chatData) {
              if (!chatData) return; // pruned, or from someone you blocked
              chatData.chatID = chatID;
              chatData.feedID = childSnapshot.key;
              if (feedData.hidden) chatData.hidden = feedData.hidden;
              ftapi.events.emit("newChat", chatData);
            }).catch(function(err) {
              console.error("[firetable] showing a chat message failed:", err);
            });
          });
          // Once the history is in, say so (an empty room has no messages to replace the placeholders)
          chatRef.once('value').then(function() { return chatChain; }).then(function() {
            ftapi.events.emit("chatHistoryLoaded");
          });
          ftapi.chatChangedEvent = chatRef.on('child_changed', function(childSnapshot, prevChildKey) {
            var feedData = childSnapshot.val();
            feedData.feedID = childSnapshot.key;
            if (feedData.hidden) ftapi.events.emit("chatRemoved", feedData);
          });
        }

        // fire users changed event on blocked users changes
        if (ftapi.blockEvent) {
          ftapi.blockRef.off("value", ftapi.blockEvent);
        }
        ftapi.blockRef = ftapi.db().ref("blocks/" + ftapi.uid);
        ftapi.blockEvent = ftapi.blockRef.on("value", function(snap) {
          var data = snap.val();
          if (data) {
            ftapi.blockedUsers = data;
          } else {
            ftapi.blockedUsers = {};
          }
          for (var key in ftapi.users) {
            var isBlocked = !!ftapi.blockedUsers[key];
            if (isBlocked !== !!ftapi.users[key].blocked) {
              ftapi.users[key].blocked = isBlocked;
              ftapi.users[key].userid = key;
              ftapi.events.emit("userChanged", ftapi.users[key]);
            }
          }
          if (ftapi.users) {
            ftapi.events.emit("usersChanged", ftapi.users);
          }
        });

        /*
        SET UP QUEUE BIND
        */
        ftapi.lookup.selectedList(function(data) {
          ftapi.selectedListThing = data;
          ftapi.queueRef = ftapi.lookup.listRef(data);

          // set up queueBind
          ftapi.queueBind = ftapi.queueRef.on('value', function(dataSnapshot) {
            var data = dataSnapshot.val();
            if (!data) data = {};
            ftapi.queue = data;
            ftapi.events.emit("playlistChanged", data, ftapi.selectedListThing);
          });

        });

        // set username if needed
        if (ftapi.nameChangeAfterSignUp) {
          var name = ftapi.nameChangeAfterSignUp.username;
          ftapi.nameChangeAfterSignUp = null;
          ftapi.pendingSignUpName = name;
          ftapi.actions.changeName(name, function() { ftapi.pendingSignUpName = null; });
        }

        // set join date if needed
        var joinRef = ftapi.db().ref("users/" + user.uid + "/joined");
        joinRef.once('value')
          .then(function(joinsnap) {
            var data = joinsnap.val();
            if (!data) {
              joinRef.set(firebase.database.ServerValue.TIMESTAMP);
            }
          });

      } else {
        // not logged in, not authenticated..
        // emit logged out state
        ftapi.events.emit("loggedOut");
      }
    } else {
      // user is already logged in.. treat these as disconnects and reconnects
      // authReconnected/authDisconnected emitters
      if (user) {
        ftapi.events.emit("authReconnected");
      } else {
        ftapi.events.emit("authDisconnected");
      }
    }
  });
};

/*
ACTIONS
*/
ftapi.actions = {
  /*
  GENERAL USER ACTIONS
  */
  /**
   * @param {string} txt
   * @param {string} [cardid] - Trading card shared with the message
   * @param {Object} [extra] - More fields to save with it (e.g. forSong)
   */
  sendChat: function(txt, cardid, extra) {
    var data = {
      time: firebase.database.ServerValue.TIMESTAMP,
      id: ftapi.uid,
      txt: txt,
      name: ftapi.uname
    };
    if (cardid) data.card = cardid;
    if (extra) {
      for (var k in extra) {
        if (extra.hasOwnProperty(k) && extra[k] !== undefined && extra[k] !== null) data[k] = extra[k];
      }
    }
    return ftapi.actions.postChat(data);
  },
  /**
   * Save a chat message and its chat feed entry in one write, so a message
   * never exists without its feed entry (or the other way round). Before the
   * database rules allow that, it falls back to the older three steps.
   * @param {Object} data - {time, id, txt, name, ...}
   * @returns {Promise}
   */
  postChat: function(data) {
    var db = ftapi.db();
    var chatID = db.ref("chatData").push().key;
    var feedID = db.ref("chatFeed").push().key;
    var updates = {};
    updates["chatData/" + chatID] = Object.assign({}, data, { feedID: feedID });
    updates["chatFeed/" + feedID] = { chatID: chatID };
    return db.ref().update(updates).catch(function(err) {
      if (!err || !/permission/i.test(err.code || err.message)) throw err;
      return new Promise(function(resolve, reject) {
        var chatItem = db.ref("chatData").push(data, function(e1) {
          if (e1) return reject(e1);
          var feedItem = db.ref("chatFeed").push({ chatID: chatItem.key }, function(e2) {
            if (e2) return reject(e2);
            chatItem.child("feedID").set(feedItem.key).then(resolve, reject);
          });
        });
      });
    }).catch(function(err) {
      console.error("[firetable] sending a chat message failed:", err);
    });
  },
  sendBotCommand: function(txt) {
    return ftapi.actions.postChat({
      time: firebase.database.ServerValue.TIMESTAMP,
      id: ftapi.uid,
      txt: txt,
      name: ftapi.uname,
      botCmd: true
    });
  },
  // Save which playlist the DJ bot should draw from, without changing the local queue view.
  switchDjList: function(listID) {
    var uref = ftapi.db().ref("users/" + ftapi.uid + "/selectedList");
    uref.set(listID);
    ftapi.selectedListThing = listID;
  },
  switchList: function(listID) {
    var uref = ftapi.db().ref("users/" + ftapi.uid + "/selectedList");
    uref.set(listID);
    ftapi.selectedListThing = listID;

    // update queue bind
    ftapi.queueRef.off("value", ftapi.queueBind); //stop listening for changes on old list

    // change queueRef to the new listID
    ftapi.queueRef = ftapi.lookup.listRef(listID);

    // setup new queueBind
    ftapi.queueBind = ftapi.queueRef.on('value', function(dataSnapshot) {
      var data = dataSnapshot.val();
      if (!data) data = {};
      ftapi.queue = data;
      ftapi.events.emit("playlistChanged", data, ftapi.selectedListThing);
    });

  },
  createList: function(listname) {
    var plref = ftapi.db().ref("playlists/" + ftapi.uid);
    var newlist = plref.push();
    var listid = newlist.key;
    var obj = {
      name: listname,
      list: {}
    };
    newlist.set(obj);
    return listid;
  },
  addToList: function(type, name, cid, dest, callback, img, url) {
    var destref;
    if (dest) {
      destref = ftapi.lookup.listRef(dest);
    } else {
      destref = ftapi.queueRef;
    }
    var info = {
      type: type,
      name: name,
      cid: cid
    };
    if (img) info.img = img;
    if (url) info.url = url;
    var newTrack = destref.push(info, function() {
      if (callback) callback();
    });
    return newTrack.key;
  },
  /**
   * Add a track as the next one to play, in one atomic step.
   * @param {Object} ref - Playlist ref (defaults to the list on screen)
   * @param {Object} info - {type, name, cid[, img][, url]}
   * @param {string} [preview] - Key of a track being previewed in this list
   * @param {Function} [pvChangeCallback] - Gets the preview's new key if it moved
   * @param {Function} [callback] - (error, newKey)
   * @returns {string} key the track was saved under
   */
  addTrackToTop: function(ref, info, preview, pvChangeCallback, callback) {
    ref = ref || ftapi.queueRef;
    var newKey = ref.push().key; // sorts after every existing key
    var track = { type: info.type, name: info.name, cid: info.cid };
    if (info.img) track.img = info.img;
    if (info.url) track.url = info.url;
    var finalKey = newKey;
    ftapi.utilities.rearrangeList(ref, function(items) {
      return [{ key: newKey, track: track }].concat(items);
    }, function(err, moves) {
      if (moves && moves[newKey]) finalKey = moves[newKey];
      ftapi.utilities.previewMover(preview, pvChangeCallback)(err, moves);
      if (callback) callback(err, finalKey);
    }, newKey);
    return newKey;
  },
  /**
   * @param {string} trackID - Row key
   * @param {Object} [ref] - Playlist ref (defaults to the list on screen)
   * @param {string} [preview]
   * @param {Function} [pvChangeCallback]
   * @param {string} [cid] - The track the row showed; if that slot now holds
   *   another track (the list changed meanwhile), that track is found instead
   */
  moveTrackToTop: function(trackID, ref, preview, pvChangeCallback, cid) {
    ftapi.utilities.rearrangeList(ref || ftapi.queueRef, function(items) {
      var idx = ftapi.utilities.findTrack(items, trackID, cid);
      if (idx <= 0) return; // already on top or gone: change nothing
      var moved = items.splice(idx, 1)[0];
      return [moved].concat(items);
    }, ftapi.utilities.previewMover(preview, pvChangeCallback));
  },
  /** See moveTrackToTop for `cid`. callback gets the track's new key. */
  moveTrackToBottom: function(trackID, callback, cid) {
    var ref = ftapi.queueRef;
    var movedKey = trackID;
    ftapi.utilities.rearrangeList(ref, function(items) {
      var idx = ftapi.utilities.findTrack(items, trackID, cid);
      if (idx === -1 || idx === items.length - 1) return; // gone, or already last
      movedKey = items[idx].key;
      var moved = items.splice(idx, 1)[0];
      items.push(moved);
      return items;
    }, function(err, moves) {
      if (!err && moves && callback) callback(moves[movedKey] || movedKey);
    });
  },
  deleteTrack: function(trackID, callback) {
    ftapi.queueRef.child(trackID).remove()
      .then(function() {
        if (callback) return callback();
      }, function(err) {
        console.error("[firetable] deleting a track failed:", err);
        if (callback) return callback(err);
      });
  },
  unflagTrack: function(trackID) {
    var removeThis = ftapi.queueRef.child(trackID + "/flagged");
    removeThis.remove();
  },
  deleteList: function(listID) {
    var removeThis = ftapi.db().ref("playlists/" + ftapi.uid + "/" + listID);
    removeThis.remove();
  },
  mergeLists: function(source, dest, callback) {
    var destref;
    destref = ftapi.lookup.listRef(dest);

    var sourceref;
    sourceref = ftapi.lookup.listRef(source);
    // create dest obj to check for duplicates
    var destObj = {};
    destref.once("value")
      .then(function(snapshot2) {
        snapshot2.forEach(function(childSnapshot) {
          var childData = childSnapshot.val();
          if (childData) {
            if (childData.cid) destObj[childData.cid] = childData.type;
          }
        });
        return sourceref.once("value")
          .then(function(snapshot3) {
            var writes = [];
            snapshot3.forEach(function(childSnapshot3) {
              var childData = childSnapshot3.val();
              if (childData) {
                if (childData.cid) {
                  var dupe = false;
                  if (destObj[childData.cid]) {
                    if (childData.type == destObj[childData.cid]) dupe = true;
                  }
                  if (!dupe) {
                    // NOT A DUPLICATE! GO GO GO
                    writes.push(destref.push(childData));
                  }
                }
              }

            });
            // Report completion only once every copy has been saved
            return Promise.all(writes);
          });
      }).then(function() {
        callback();
      }, function(err) {
        console.error("[firetable] merge failed:", err);
        callback(err || true);
      });
  },
  shuffleList: function(preview, pvChangeCallback) {
    ftapi.utilities.rearrangeList(ftapi.queueRef, function(items) {
      return ftapi.utilities.shuffle(items);
    }, ftapi.utilities.previewMover(preview, pvChangeCallback));
  },
  removeDuplicatesFromList: function(listID, callback) {
    // Read the chosen list itself (not whichever list is on screen), then
    // delete every later copy of a track (same type and id, as merge counts
    // them), keeping the first one.
    var ref = ftapi.lookup.listRef(listID);
    ref.once("value").then(function(snap) {
      var seen = {};
      var dupes = [];
      snap.forEach(function(child) {
        var track = child.val();
        if (!track) return;
        var id = track.type + ":" + track.cid;
        if (seen.hasOwnProperty(id)) dupes.push(child.key);
        else seen[id] = true;
      });
      return Promise.all(dupes.map(function(key) {
        return ref.child(key).remove();
      }));
    }).then(function() {
      if (callback) callback();
    }, function(err) {
      console.error("[firetable] duplicate cleanup failed:", err);
      if (callback) callback(err || true);
    });
  },
  /**
   * Save a new order from the list on screen. Tracks the bot (or another tab)
   * added meanwhile, which aren't in `arr`, keep their place after the rest.
   * @param {Array<string>} arr - Track keys in the new order
   */
  reorderList: function(arr, preview, pvChangeCallback) {
    if (!arr.length) return;
    ftapi.utilities.rearrangeList(ftapi.queueRef, function(items) {
      var byKey = {};
      items.forEach(function(it) { byKey[it.key] = it; });
      var out = [];
      arr.forEach(function(k) { if (byKey[k]) { out.push(byKey[k]); delete byKey[k]; } });
      items.forEach(function(it) { if (byKey[it.key]) out.push(it); });
      return out;
    }, ftapi.utilities.previewMover(preview, pvChangeCallback));
  },
  blockUser: function(username, callback) {
    ftapi.lookup.userByName(username, function(data) {
      if (!data) return callback("There is no " + username);
      var response;
      if (data.mod || data.supermod || data.hostbot) {
        response = "You can not block this person.";
      } else {
        ftapi.blockRef.child(data.userid).set(true);
        response = username + " blocked. They will not see your chats, and you will not see their chats.";
      }
      return callback(response);
    });
  },
  unblockUser: function(username, callback) {
    ftapi.lookup.userByName(username, function(data) {
      if (!data) return callback("There is no " + username);
      var response;
      if (ftapi.blockedUsers[data.userid]) {
        ftapi.blockRef.child(data.userid).remove();
        response = username + " has been unblocked. You will now see their chats, and they will see your chats.";
      } else {
        response = username + " wasn't even blocked to begin with...";
      }
      return callback(response);
    });
  },
  /*
  AUTH ACTIONS
  */
  changeIdleStatus: function(idle, audio) {
    if (!ftapi.uid) return;
    // Hide + idle-timer (or show + activity) both report the same state; every
    // write reaches everyone in the room, so skip repeats.
    var state = ftapi.uid + "|" + idle + "|" + audio;
    if (state === ftapi._lastIdleState) return;
    ftapi._lastIdleState = state;
    var ref = ftapi.db().ref("users/" + ftapi.uid + "/idle");
    ref.set({
      isIdle: idle,
      audio: audio,
      since: firebase.database.ServerValue.TIMESTAMP
    });
  },
  changeName: function(newName, callback) {
    if (!newName) return;
    // locally validate name for length and char requirements before sending to firebase
    callback = callback || function() {};
    var validateName = ftapi.utilities.validateUsername(newName);
    if (!validateName.valid) return callback(validateName.reason);
    // claim before we can change. Claims are lowercase, so a name is unique
    // whatever its case: "Boss" can't be taken while "boss" is in use.
    var claimRef = ftapi.db().ref("nameClaim/" + newName.toLowerCase());
    claimRef.set(ftapi.uid, function(error) {
      if (error) return callback("This username is not available");
      // name claimed, now we can set it
      var setRef = ftapi.db().ref("users/" + ftapi.uid + "/username");
      setRef.set(newName, function(error) {
        callback(error ? "This username is not available" : undefined);
      });
    });
  },
  logOut: function() {
    var ref0 = ftapi.db().ref("users/" + ftapi.uid + "/status");
    ref0.set(false);
    ftapi.detachSession();
    ftapi.uid = null;
    ftapi.loggedIn = false;
    ftapi.events.emit("loggedOut");
    firebase.app("firetable").auth().signOut();
  },
  logIn: function(email, password, errorCallback) {
    ftapi.nameChangeAfterSignUp = null; // a failed sign-up must not rename this account
    firebase.app("firetable").auth().signInWithEmailAndPassword(email, password).catch(function(error) {
      return errorCallback(error);
    });
  },
  /**
   * Sign in (or sign up) with Google or Apple. Uses a popup, or a full-page
   * redirect where popups can't open (blocked, or an installed web app).
   * @param {"google"|"apple"} name
   * @param {Function} errorCallback - (error)
   */
  logInWithProvider: function(name, errorCallback) {
    ftapi.nameChangeAfterSignUp = null;
    var provider;
    if (name === "apple") {
      provider = new firebase.auth.OAuthProvider("apple.com");
      provider.addScope("email");
      provider.addScope("name");
    } else {
      provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
    }
    var auth = firebase.app("firetable").auth();
    var standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    if (standalone) return auth.signInWithRedirect(provider).catch(errorCallback);
    auth.signInWithPopup(provider).catch(function(error) {
      if (error && (error.code === "auth/popup-blocked" || error.code === "auth/operation-not-supported-in-environment")) {
        return auth.signInWithRedirect(provider).catch(errorCallback);
      }
      return errorCallback(error);
    });
  },
  /** Errors from a redirect sign-in that came back to this page (resolves null if none). */
  redirectSignInError: function() {
    return firebase.app("firetable").auth().getRedirectResult().then(function() { return null; }, function(error) { return error; });
  },
  resetPassword: function(email, errorCallback) {
    firebase.app("firetable").auth().sendPasswordResetEmail(email).catch(function(error) {
      return errorCallback(error);
    });
  },
  signUp: function(email, password, username, errorCallback) {
    var validateName = ftapi.utilities.validateUsername(username);
    if (!validateName.valid) {
      return errorCallback(validateName.reason);
    }
    ftapi.lookup.usernameTaken(username, function(taken) {
      if (taken) {
        return errorCallback("This username is not available.");
      } else {
        ftapi.nameChangeAfterSignUp = {
          username: username
        };
        firebase.app("firetable").auth().createUserWithEmailAndPassword(email, password).catch(function(error) {
          ftapi.nameChangeAfterSignUp = null;
          return errorCallback(error);
        });
      }
    })
  },
  /*
  ADMIN ACTIONS
  */
  unbanUser: function(userid) {
    var ref = ftapi.db().ref("banned/" + userid);
    ref.set(false);
  },
  banUser: function(userid) {
    var ref = ftapi.db().ref("banned/" + userid);
    ref.set(true);
  },
  modUser: function(userid) {
    var modp = ftapi.db().ref("users/" + userid + "/mod");
    modp.set(true);
  },
  unmodUser: function(userid) {
    var modp = ftapi.db().ref("users/" + userid + "/mod");
    modp.set(false);
  },
  deleteChat: function(feedID) {
    var feedEntry = ftapi.db().ref("chatFeed/" + feedID + "/hidden");
    feedEntry.set(true);
  },
  /**
   * Correct a play's "Artist - Title" (mods). Saves the history entry and the
   * track's global tags in one atomic write, then emits "editedHistory" so the
   * row updates even when it's an older play outside the live window.
   * @param {string|number} type - MEDIA_YOUTUBE / MEDIA_SOUNDCLOUD
   * @param {string} cid
   * @param {string} tag - "Artist - Title"
   * @param {string} histID - Row key
   * @param {string} [list="songHistory"] - Where the row came from; rows from
   *   Fresh (newMusic) only update the global tags (only the bot writes there)
   * @param {Function} [callback] - (error)
   */
  editTag: function(type, cid, tag, histID, list, callback) {
    // Split on the FIRST " - " only, so titles that contain " - "
    // (e.g. "Song - Live Version") keep everything after it.
    var sep = tag.indexOf(" - ");
    var theartist = sep === -1 ? tag : tag.slice(0, sep);
    var thetitle = sep === -1 ? "" : tag.slice(sep + 3);
    var isHistory = !list || list === "songHistory";
    // The bot keeps only the latest plays; writing to a play it has already
    // removed would create a bogus entry in Recent (#147), so check first.
    var exists = isHistory && histID
      ? ftapi.db().ref("songHistory/" + histID + "/cid").once("value").then(function(snap) { return snap.exists(); })
      : Promise.resolve(false);
    exists.then(function(inHistory) {
      var updates = {};
      if (inHistory) {
        updates["songHistory/" + histID + "/artist"] = theartist;
        updates["songHistory/" + histID + "/title"] = thetitle;
      }
      updates["globalTracks/" + type + cid + "/artist"] = theartist;
      updates["globalTracks/" + type + cid + "/title"] = thetitle;
      return ftapi.db().ref().update(updates);
    }).then(function() {
      ftapi.events.emit("editedHistory", { histID: histID, artist: theartist, title: thetitle, list: list || "songHistory" });
      if (callback) callback(null);
    }, function(error) {
      console.error("[firetable] tag edit failed:", error);
      if (callback) callback(error);
    });
  }
};

ftapi.lookup = {
  /*
  DATA LOOKUP FUNCTIONS
  */
  /**
   * Database ref for one of the user's lists: "0" (or 0) is the Default
   * playlist (queues/<uid>), anything else is playlists/<uid>/<id>/list.
   * @param {string|number} listID
   */
  listRef: function(listID) {
    var db = ftapi.db();
    return (listID === undefined || listID === null || String(listID) === "0")
      ? db.ref("queues/" + ftapi.uid)
      : db.ref("playlists/" + ftapi.uid + "/" + listID + "/list");
  },
  /**
   * A chat message's data. Resolves null when it can't be read (deleted, or
   * the rules hide it because one of you blocked the other).
   * @param {string} chatID
   * @param {Function} [callback] - Also called with the data (or null)
   * @returns {Promise<Object|null>}
   */
  chatData: function(chatID, callback) {
    var chatData = ftapi.db().ref("chatData/" + chatID);
    return chatData.once('value')
      .then(function(snap) { return snap.val(); }, function() { return null; })
      .then(function(data) {
        if (callback) callback(data);
        return data;
      });
  },
  /**
   * Load the page of plays just before the oldest one shown.
   * @param {Function} callback - (plays, hasMore): plays oldest-first, each with histID
   */
  olderHistory: function(callback) {
    var before = ftapi.oldestHistoryKey;
    if (!before) return callback([], false);
    ftapi.db().ref("songHistory")
      .orderByKey().endBefore(before).limitToLast(HISTORY_PAGE_SIZE).once("value")
      .then(function(snap) {
        var plays = [];
        snap.forEach(function(child) {
          var data = child.val();
          if (!data) return;
          data.histID = child.key;
          plays.push(data);
        });
        if (plays.length) ftapi.oldestHistoryKey = plays[0].histID;
        callback(plays, plays.length === HISTORY_PAGE_SIZE);
      }, function(err) {
        console.error("[firetable] loading older plays failed:", err);
        callback([], true);
      });
  },
  card: function(cardid, callback) {
    ftapi.utilities.read(ftapi.db().ref("cards/" + cardid), null, "a card").then(callback);
  },
  cardCollection: function(callback) {
    ftapi.utilities.read(ftapi.db().ref("cards").orderByChild('owner').equalTo(ftapi.uid), null, "your cards").then(callback);
  },
  /**
   * Is this username in use by someone else, in any case ("Boss" counts as
   * "boss")? Checks the lowercase name claim, then (for accounts from before
   * claims were lowercase) the exact name.
   * @param {string} name
   * @param {Function} callback - (taken)
   */
  usernameTaken: function(name, callback) {
    var db = ftapi.db();
    var lower = String(name).toLowerCase();
    var claimHolder = /^[0-9a-z_]{1,22}$/.test(lower)
      ? db.ref("nameClaim/" + lower).once("value").then(function(snap) { return snap.val(); }, function() { return null; })
      : Promise.resolve(null);
    claimHolder.then(function(holder) {
      if (typeof holder !== "string" || holder === ftapi.uid) return false;
      // a claim only counts while its holder still goes by that name
      return db.ref("users/" + holder + "/username").once("value").then(function(snap) {
        return typeof snap.val() === "string" && snap.val().toLowerCase() === lower;
      });
    }).then(function(taken) {
      if (taken) return true;
      return db.ref("users").orderByChild('username').equalTo(name).once("value").then(function(snapshot) {
        var exact = false;
        snapshot.forEach(function(child) {
          if (child.key !== ftapi.uid) exact = true;
        });
        return exact;
      });
    }).then(callback, function(err) {
      console.error("[firetable] username check failed:", err);
      callback(false); // the claim itself still refuses a taken name
    });
  },
  /**
   * A user by name, in any case ("@boss" finds "Boss"), or by user id.
   * @param {string} name
   * @param {Function} callback - (user with .userid, or null)
   */
  userByName: function(name, callback) {
    var db = ftapi.db();
    var lower = String(name).toLowerCase();
    db.ref("users").orderByChild('username').equalTo(name).once("value")
      .then(function(snapshot) {
        var found = null;
        snapshot.forEach(function(child) {
          if (found) return;
          found = child.val();
          found.userid = child.key;
        });
        if (found) return callback(found);
        if (!/^[0-9a-z_]{1,22}$/.test(lower)) return ftapi.lookup.userByID(name, callback);
        return db.ref("nameClaim/" + lower).once("value").then(function(snap) { return snap.val(); }, function() { return null; })
          .then(function(uid) {
            if (typeof uid !== "string") return ftapi.lookup.userByID(name, callback);
            ftapi.lookup.userByID(uid, function(person) {
              if (person && String(person.username).toLowerCase() === lower) return callback(person);
              ftapi.lookup.userByID(name, callback);
            });
          });
      }, function(err) {
        console.error("[firetable] looking up " + name + " failed:", err);
        callback(null);
      });
  },
  userByID: function(userid, callback) {
    // ids and names can't hold . # $ [ ] (not valid in a database path)
    if (!userid || /[.#$[\]]/.test(String(userid))) return callback(null);
    ftapi.utilities.read(ftapi.db().ref("users/" + userid), null, "a profile").then(function(person) {
      if (person) {
        person.userid = userid;
        if (!person.username) person.username = userid;
      }
      return callback(person || null);
    });
  },
  selectedList: function(callback) {
    // can't be read: the Default playlist
    ftapi.utilities.read(ftapi.db().ref("users/" + ftapi.uid + "/selectedList"), "0", "your selected playlist").then(function(data) {
      return callback(data || "0");
    });
  },
  /**
   * Your playlists' names without their tracks, as {listID: {name}}: the
   * database's REST "shallow" read lists the ids, then only each name is
   * read. The pickers and menus need nothing more, and a big list would
   * otherwise download in full every time one opens. Falls back to
   * ftapi.lookup.allLists if the shallow read fails.
   * @param {Function} callback
   */
  listNames: function(callback) {
    var uid = ftapi.uid;
    var app = firebase.app("firetable");
    var user = app.auth().currentUser;
    var base = app.options.databaseURL;
    if (!uid || !user || !base || typeof fetch !== "function") return ftapi.lookup.allLists(callback);
    user.getIdToken().then(function(token) {
      var url = new URL(base);
      url.pathname = url.pathname.replace(/\/?$/, "/") + "playlists/" + encodeURIComponent(uid) + ".json";
      url.searchParams.set("shallow", "true");
      url.searchParams.set("auth", token);
      return fetch(url.toString(), { cache: "no-store" });
    }).then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function(ids) {
      var db = ftapi.db();
      return Promise.all(Object.keys(ids && typeof ids === "object" ? ids : {}).map(function(id) {
        return db.ref("playlists/" + uid + "/" + id + "/name").once("value").then(function(snap) {
          return [id, snap.val()];
        });
      }));
    }).then(function(pairs) {
      var names = {};
      pairs.forEach(function(p) { names[p[0]] = { name: p[1] }; });
      callback(names);
    }).catch(function(err) {
      console.warn("[firetable] listing playlists by name failed (" + (err && err.message) + "); reading them in full");
      ftapi.lookup.allLists(callback);
    });
  },
  /** Every playlist with all its tracks (the playlist overview counts them). */
  allLists: function(callback) {
    ftapi.utilities.read(ftapi.db().ref("playlists/" + ftapi.uid), null, "your playlists").then(callback);
  }
};

/*
UTILITY FUNCTIONS
*/
ftapi.utilities = {
  /**
   * Read a ref or query once. Resolves its value, or `fallback` when it can't
   * be read (network, or the rules refuse it), so callers always get an answer.
   * @param {Object} ref - Database ref or query
   * @param {*} fallback
   * @param {string} what - For the console message
   * @returns {Promise}
   */
  read: function(ref, fallback, what) {
    return ref.once("value").then(function(snap) {
      return snap.val();
    }, function(err) {
      console.error("[firetable] couldn't read " + what + ":", err);
      return fallback;
    });
  },
  /**
   * Firebase's child-key order: keys that are 32-bit integers first
   * (numerically), then everything else as plain strings.
   */
  compareKeys: function(a, b) {
    var intA = /^-?\d{1,10}$/.test(a), intB = /^-?\d{1,10}$/.test(b);
    if (intA && intB) return Number(a) - Number(b);
    if (intA) return -1;
    if (intB) return 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  },
  /**
   * Reorder a playlist atomically.
   *
   * A list plays in key order. `arrange(items)` gets the tracks in that order
   * as [{key, track}] and returns them in the new order (it may also add one
   * entry under `newKey`, from ref.push().key); returning nothing changes
   * nothing. The tracks are written back into the list's slots in key order.
   *
   * It runs as a transaction: if the bot plays a track (removing it and
   * re-adding it at the bottom) or another tab edits the list at the same
   * moment, it re-runs on the fresh data instead of overwriting that change.
   *
   * @param {Object} ref - Playlist ref
   * @param {Function} arrange - (items) => items in the new order, or undefined
   * @param {Function} [onDone] - (error, moves) — moves maps old key → new key
   * @param {string} [newKey] - Key of a track `arrange` adds
   */
  rearrangeList: function(ref, arrange, onDone, newKey) {
    var moves = null;
    ref.transaction(function(current) {
      if (!current && !newKey) return current; // nothing cached yet: let Firebase fetch
      current = current || {};
      var keys = Object.keys(current).sort(ftapi.utilities.compareKeys);
      var items = keys.map(function(k) { return { key: k, track: current[k] }; });
      var ordered = arrange(items.slice());
      if (!ordered) return; // abort: nothing to change
      var slots = keys.slice();
      if (newKey && slots.indexOf(newKey) === -1) slots.push(newKey);
      slots.sort(ftapi.utilities.compareKeys);
      if (ordered.length !== slots.length) return; // shouldn't happen; never drop tracks
      var out = {};
      moves = {};
      for (var i = 0; i < slots.length; i++) {
        out[slots[i]] = ordered[i].track;
        moves[ordered[i].key] = slots[i];
      }
      return out;
    }, function(err, committed) {
      if (err) console.error("[firetable] playlist update failed:", err);
      if (onDone) onDone(err, committed ? moves : null);
    });
  },
  /**
   * Index of a row in rearrangeList items: the slot `key` if it still holds
   * track `cid` (or no cid is given), otherwise the first slot holding `cid`.
   * @returns {number} -1 when not found
   */
  findTrack: function(items, key, cid) {
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].key === key) {
        if (!cid || !items[i].track || String(items[i].track.cid) === String(cid)) return i;
        break;
      }
    }
    if (!cid) return -1;
    for (i = 0; i < items.length; i++) {
      if (items[i].track && String(items[i].track.cid) === String(cid)) return i;
    }
    return -1;
  },
  /** onDone for rearrangeList that keeps a running preview pointed at its track. */
  previewMover: function(preview, pvChangeCallback) {
    return function(err, moves) {
      if (preview && pvChangeCallback && moves && moves[preview] && moves[preview] !== preview) {
        pvChangeCallback(moves[preview]);
      }
    };
  },
  // Modern Fisher-Yates shuffle
  shuffle: function(a) {
    var j, x, i;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      x = a[i];
      a[i] = a[j];
      a[j] = x;
    }
    return a;
  },
  size: function(obj) {
    var size = 0;
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) size++;
    }
    return size;
  },
  validateUsername: function(username) {
    var reason = null;
    if (username.length > 22) {
      var diff = username.length - 22;
      reason = "Name too long... Remove at least " + diff + " character(s).";
    } else if (!username.match(/^[0-9a-zA-Z_]{1,22}$/)) {
      reason = "Invalid name... Only use a combination of letters, numbers, and underscores.";
    }
    var valid = true;
    if (reason) {
      valid = false;
    }
    return {
      valid: valid,
      reason: reason
    };
  }
};

/*
EVENT EMITTER
*/
var EventEmitter = function() {
  this.events = {};
};

EventEmitter.prototype.on = function(event, listener) {
  if (typeof this.events[event] !== 'object') {
    this.events[event] = [];
  }

  this.events[event].push(listener);
};

EventEmitter.prototype.removeListener = function(event, listener) {
  var idx;

  if (typeof this.events[event] === 'object') {
    idx = this.events[event].indexOf(listener);

    if (idx > -1) {
      this.events[event].splice(idx, 1);
    }
  }
};

EventEmitter.prototype.emit = function(event) {
  var i, listeners, length, args = [].slice.call(arguments, 1);

  if (typeof this.events[event] === 'object') {
    listeners = this.events[event].slice();
    length = listeners.length;

    // A listener that throws is logged; the others still run (one broken
    // panel mustn't stop the song, chat or deck from updating)
    for (i = 0; i < length; i++) {
      try {
        listeners[i].apply(this, args);
      } catch (err) {
        console.error('[firetable] a "' + event + '" listener failed:', err);
      }
    }
  }
};

EventEmitter.prototype.once = function(event, listener) {
  this.on(event, function g() {
    this.removeListener(event, g);
    listener.apply(this, arguments);
  });
};

ftapi.ready();