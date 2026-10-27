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
  firebase.app("firetable").database().ref(".info/serverTimeOffset").on("value", function(snap) {
    ftapi.serverTimeOffset = Number(snap.val()) || 0;
  });


  /*
  NON-AUTHENTICATED FIRETABLE EVENT BINDINGS
  All realtime events for the non-authenticated user
  These will persist regardless of auth state changes
  */
  // users change event emitter
  var ref2 = firebase.app("firetable").database().ref("users");
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
    if (ftapi.users[ftapi.uid]) {
      if (ftapi.users[ftapi.uid].username) {
        ftapi.uname = ftapi.users[ftapi.uid].username;
      }
    }
    ftapi.events.emit("usersChanged", okdata);
    if (ftapi.uid) {
      if (!ftapi.users[ftapi.uid]) {
        //Firebase thinks you are not here (but you are totally here!)
        ftapi.presenceDetectRef = firebase.app("firetable").database().ref("users/" + ftapi.uid + "/status");
        ftapi.presenceDetectEvent = ftapi.presenceDetectRef.onDisconnect().set(false);
        ftapi.presenceDetectRef.set(true);
      } else {
        if (ftapi.users[ftapi.uid].supermod) {
          if (!ftapi.superCopBanUpdates) {
            //begin event listener for ban updates
            ftapi.superCopRef = firebase.app("firetable").database().ref("banned");
            ftapi.superCopBanUpdates = ftapi.superCopRef.on('value', function(dataSnapshot) {
              ftapi.events.emit("banListChanged", dataSnapshot.val());
            });
          }
        }
      }
    }
  });

  // new song event emitter
  var s2p = firebase.app("firetable").database().ref("songToPlay");
  s2p.on('value', function(dataSnapshot) {
    var songData = dataSnapshot.val();
    ftapi.events.emit("newSong", songData);
  });

  // song tag update emitter
  var tagUpdate = firebase.app("firetable").database().ref("tagUpdate");
  tagUpdate.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    if (!data) return;
    ftapi.events.emit("tagUpdate", data);
  });

  // history emitter: the latest plays only; older ones load on request
  // (ftapi.lookup.olderHistory). Both listeners use the same limited query,
  // so the full history is never downloaded.
  var recentz = firebase.app("firetable").database().ref("songHistory").limitToLast(HISTORY_PAGE_SIZE);
  ftapi.historyLoaded = 0;
  recentz.on('child_added', function(dataSnapshot, prev) {
    var data = dataSnapshot.val();
    data.histID = dataSnapshot.key;
    if (!ftapi.oldestHistoryKey || dataSnapshot.key < ftapi.oldestHistoryKey) ftapi.oldestHistoryKey = dataSnapshot.key;
    ftapi.historyLoaded++;
    ftapi.events.emit("newHistory", data);
  });

  recentz.on('child_changed', function(dataSnapshot) {
    var data = dataSnapshot.val();
    data.histID = dataSnapshot.key;
    ftapi.events.emit("editedHistory", data);
  });

  // new songs emitter
  var freshproduce = firebase.app("firetable").database().ref("newMusic");
  freshproduce.on('child_added', function(dataSnapshot, prev) {
    var data = dataSnapshot.val();
    data.histID = dataSnapshot.key;
    ftapi.events.emit("newProduce", data);
  });


  // table change emitter
  var tbl = firebase.app("firetable").database().ref("table");
  tbl.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("tableChanged", data);
  });

  // spotlight state changed emitter
  var pldx = firebase.app("firetable").database().ref("playdex");
  pldx.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("spotlightStateChanged", data);
  });

  // playlimit change emitter
  var plc = firebase.app("firetable").database().ref("playlimit");
  plc.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("playLimitChanged", data);
  });

  // waitlist change emitter
  var wl = firebase.app("firetable").database().ref("waitlist");
  wl.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("waitlistChanged", data);
  });

  // new theme emitter
  var themeChange = firebase.app("firetable").database().ref("theme");
  themeChange.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("newTheme", data);
  });

  // dance state emitter
  var danceCheck = firebase.app("firetable").database().ref("dance");
  danceCheck.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("danceStateChanged", data);
  });

  // festive lights emitter
  var lightsCheck = firebase.app("firetable").database().ref("lights");
  lightsCheck.on('value', function(dataSnapshot) {
    ftapi.events.emit("lightsChanged", dataSnapshot.val());
  });

  // screen sync change emitter
  var thescreen = firebase.app("firetable").database().ref("thescreen");
  thescreen.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val();
    ftapi.events.emit("screenStateChanged", data);
  });

  var colors = firebase.app("firetable").database().ref("colors");
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
        ftapi.connectedRef = firebase.app("firetable").database().ref('.info/connected');
        ftapi.connectedEvent = ftapi.connectedRef.on('value', function(snap) {
          if (snap.val() === true && ftapi.uid) {
            ftapi.presenceDetectRef = firebase.app("firetable").database().ref("users/" + ftapi.uid + "/status");
            ftapi.presenceDetectEvent = ftapi.presenceDetectRef.onDisconnect().set(false);
            ftapi.presenceDetectRef.set(true);
          }
        });
        var returnData = {
          email: user.email,
          uid: user.uid
        };
        ftapi.uid = user.uid;
        ftapi.uname = user.uid;
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
        ftapi.banRef = firebase.app("firetable").database().ref("banned/" + ftapi.uid);
        ftapi.banEvent = ftapi.banRef.on('value', function(dataSnapshot) {
          var data = dataSnapshot.val();
          if (data) {
            if (!ftapi.banned) {
              ftapi.banned = true;
              var ref0 = firebase.app("firetable").database().ref("users/" + ftapi.uid + "/status");
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
          var chatRef = firebase.app("firetable").database().ref("chatFeed").limitToLast(CHAT_HISTORY_LIMIT);
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
        ftapi.blockRef = firebase.app("firetable").database().ref("blocks/" + ftapi.uid);
        ftapi.blockEvent = ftapi.blockRef.on("value", function(snap) {
          var data = snap.val();
          if (data) {
            ftapi.blockedUsers = data;
          } else {
            ftapi.blockedUsers = {};
          }
          for (var key in ftapi.users) {
            if (ftapi.blockedUsers[key]) {
              // person is here
              ftapi.users[key].blocked = true;
              var changeData = ftapi.users[key];
              changeData.userid = key;
              ftapi.events.emit("userChanged", changeData);
            } else {
              if (ftapi.users[key].blocked) {
                ftapi.users[key].blocked = false;
                var changeData = ftapi.users[key];
                changeData.userid = key;
                ftapi.events.emit("userChanged", changeData);
              }
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
          ftapi.actions.changeName(name);
        }

        // set join date if needed
        var joinRef = firebase.app("firetable").database().ref("users/" + user.uid + "/joined");
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
  sendChat: function(txt, cardid) {
    var chatFeed = firebase.app("firetable").database().ref("chatFeed");
    var chatData = firebase.app("firetable").database().ref("chatData");
    var data = {
      time: firebase.database.ServerValue.TIMESTAMP,
      id: ftapi.uid,
      txt: txt,
      name: ftapi.uname
    };
    if (cardid) data.card = cardid;
    var chatItem = chatData.push(data, function() {
      var feedObj = {
        chatID: chatItem.key
      };
      var feedItem = chatFeed.push(feedObj, function() {
        chatItem.child("feedID").set(feedItem.key);
      });
    });
  },
  sendBotCommand: function(txt) {
    var chatFeed = firebase.app("firetable").database().ref("chatFeed");
    var chatData = firebase.app("firetable").database().ref("chatData");
    var data = {
      time: firebase.database.ServerValue.TIMESTAMP,
      id: ftapi.uid,
      txt: txt,
      name: ftapi.uname,
      botCmd: true
    };
    var chatItem = chatData.push(data, function() {
      var feedObj = { chatID: chatItem.key };
      var feedItem = chatFeed.push(feedObj, function() {
        chatItem.child("feedID").set(feedItem.key);
      });
    });
  },
  // Save which playlist the DJ bot should draw from, without changing the local queue view.
  switchDjList: function(listID) {
    var uref = firebase.app("firetable").database().ref("users/" + ftapi.uid + "/selectedList");
    uref.set(listID);
    ftapi.selectedListThing = listID;
  },
  switchList: function(listID) {
    var uref = firebase.app("firetable").database().ref("users/" + ftapi.uid + "/selectedList");
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
    var plref = firebase.app("firetable").database().ref("playlists/" + ftapi.uid);
    var newlist = plref.push();
    var listid = newlist.key;
    var obj = {
      name: listname,
      list: {}
    };
    newlist.set(obj);
    return listid;
  },
  addToList: function(type, name, cid, dest, callback, img) {
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
    var newTrack = destref.push(info, function() {
      if (callback) callback();
    });
    return newTrack.key;
  },
  /**
   * Add a track as the next one to play, in one atomic step.
   * @param {Object} ref - Playlist ref (defaults to the list on screen)
   * @param {Object} info - {type, name, cid[, img]}
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
  moveTrackToTop: function(trackID, ref, preview, pvChangeCallback) {
    ftapi.utilities.rearrangeList(ref || ftapi.queueRef, function(items) {
      var idx = -1;
      for (var i = 0; i < items.length; i++) if (items[i].key === trackID) idx = i;
      if (idx <= 0) return; // already on top or gone: change nothing
      var moved = items.splice(idx, 1)[0];
      return [moved].concat(items);
    }, ftapi.utilities.previewMover(preview, pvChangeCallback));
  },
  moveTrackToBottom: function(trackID, callback) {
    var ref = ftapi.queueRef;
    ftapi.utilities.rearrangeList(ref, function(items) {
      var idx = -1;
      for (var i = 0; i < items.length; i++) if (items[i].key === trackID) idx = i;
      if (idx === -1 || idx === items.length - 1) return; // gone, or already last
      var moved = items.splice(idx, 1)[0];
      items.push(moved);
      return items;
    }, function(err, moves) {
      if (!err && moves && callback) callback(moves[trackID] || trackID);
    });
  },
  deleteTrack: function(trackID, callback) {
    var removeThis = ftapi.queueRef.child(trackID);
    removeThis.remove()
      .then(function() {
        if (callback) return callback();
      });
  },
  unflagTrack: function(trackID) {
    var removeThis = ftapi.queueRef.child(trackID + "/flagged");
    removeThis.remove();
  },
  deleteList: function(listID) {
    var removeThis = firebase.app("firetable").database().ref("playlists/" + ftapi.uid + "/" + listID);
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
          var key = childSnapshot.key;
          var childData = childSnapshot.val();
          if (childData) {
            if (childData.cid) destObj[childData.cid] = childData.type;
          }
        });
        sourceref.once("value")
          .then(function(snapshot3) {
            var writes = [];
            snapshot3.forEach(function(childSnapshot3) {
              var key = childSnapshot3.key;
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
            Promise.all(writes).then(function() {
              callback();
            }, function(err) {
              console.error("[firetable] merge failed:", err);
              callback(err || true);
            });
          });
      });
  },
  shuffleList: function(preview, pvChangeCallback) {
    ftapi.utilities.rearrangeList(ftapi.queueRef, function(items) {
      return ftapi.utilities.shuffle(items);
    }, ftapi.utilities.previewMover(preview, pvChangeCallback));
  },
  removeDuplicatesFromList: function(listID, callback) {
    // Read the chosen list itself (not whichever list is on screen), then
    // delete every later copy of a track id, keeping the first one.
    var ref = ftapi.lookup.listRef(listID);
    ref.once("value").then(function(snap) {
      var seen = {};
      var dupes = [];
      snap.forEach(function(child) {
        var track = child.val();
        if (!track) return;
        if (seen.hasOwnProperty(track.cid)) dupes.push(child.key);
        else seen[track.cid] = true;
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
    var ref = firebase.app("firetable").database().ref("users/" + ftapi.uid + "/idle");
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
    // claim before we can change
    var claimRef = firebase.app("firetable").database().ref("nameClaim/" + newName);
    claimRef.set(ftapi.uid, function(error) {
      if (error) return callback("This username is not available");
      // name claimed, now we can set it
      var setRef = firebase.app("firetable").database().ref("users/" + ftapi.uid + "/username");
      setRef.set(newName, function(error) {
        callback(error ? "This username is not available" : undefined);
      });
    });
  },
  logOut: function() {
    var ref0 = firebase.app("firetable").database().ref("users/" + ftapi.uid + "/status");
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
    var ref = firebase.app("firetable").database().ref("banned/" + userid);
    ref.set(false);
  },
  banUser: function(userid) {
    var ref = firebase.app("firetable").database().ref("banned/" + userid);
    ref.set(true);
  },
  modUser: function(userid) {
    var modp = firebase.app("firetable").database().ref("users/" + userid + "/mod");
    modp.set(true);
  },
  unmodUser: function(userid) {
    var modp = firebase.app("firetable").database().ref("users/" + userid + "/mod");
    modp.set(false);
  },
  deleteChat: function(feedID) {
    var feedEntry = firebase.app("firetable").database().ref("chatFeed/" + feedID + "/hidden");
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
    var updates = {};
    if (!list || list === "songHistory") {
      updates["songHistory/" + histID + "/artist"] = theartist;
      updates["songHistory/" + histID + "/title"] = thetitle;
    }
    updates["globalTracks/" + type + cid + "/artist"] = theartist;
    updates["globalTracks/" + type + cid + "/title"] = thetitle;
    firebase.app("firetable").database().ref().update(updates, function(error) {
      if (error) {
        console.error("[firetable] tag edit failed:", error);
      } else {
        ftapi.events.emit("editedHistory", { histID: histID, artist: theartist, title: thetitle, list: list || "songHistory" });
      }
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
    var db = firebase.app("firetable").database();
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
    var chatData = firebase.app("firetable").database().ref("chatData/" + chatID);
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
    firebase.app("firetable").database().ref("songHistory")
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
    var thecard = firebase.app("firetable").database().ref("cards/" + cardid);
    thecard.once('value')
      .then(function(snap) {
        var data = snap.val();
        return callback(data);
      });
  },
  cardCollection: function(callback) {
    var niceref = firebase.app("firetable").database().ref("cards");
    niceref.orderByChild('owner').equalTo(ftapi.uid).once("value")
      .then(function(snapshot) {
        var cards = snapshot.val();
        return callback(cards);
      });
  },
  usernameTaken: function(name, callback) {
    var searchByName = firebase.app("firetable").database().ref("users");
    searchByName.orderByChild('username').equalTo(name).once("value")
      .then(function(snapshot) {
        var data = snapshot.val();
        var taken = false;
        if (data) {
          taken = true;
        }
        return callback(taken);
      });
  },
  userByName: function(name, callback) {
    var searchByName = firebase.app("firetable").database().ref("users");
    var ppl = [];
    searchByName.orderByChild('username').equalTo(name).once("value")
      .then(function(snapshot) {
        snapshot.forEach(function(childSnapshot) {
          var key = childSnapshot.key;
          var childData = childSnapshot.val();
          childData.userid = key;
          ppl.push(childData);
        });
        if (ppl[0]) {
          return callback(ppl[0]);
        } else {
          ftapi.lookup.userByID(name, callback);
        }
      });
  },
  userByID: function(userid, callback) {
    var searchByID = firebase.app("firetable").database().ref("users/" + userid);
    var person = null;
    searchByID.once("value")
      .then(function(snapshot2) {
        var childData2 = snapshot2.val();
        if (childData2) {
          var key2 = snapshot2.key;
          childData2.userid = key2;
          if (!childData2.username) childData2.username = key2;
          person = childData2;
        }
        return callback(person);
      });
  },
  selectedList: function(callback) {
    var getSelect = firebase.app("firetable").database().ref("users/" + ftapi.uid + "/selectedList");
    getSelect.once('value')
      .then(function(snappy) {
        data = snappy.val();
        if (!data) data = "0";
        return callback(data);
      });
  },
  allLists: function(callback) {
    var allQueues = firebase.app("firetable").database().ref("playlists/" + ftapi.uid);
    allQueues.once('value')
      .then(function(allQueuesSnap) {
        var allPlaylists = allQueuesSnap.val();
        return callback(allPlaylists);
      });
  }
};

/*
UTILITY FUNCTIONS
*/
ftapi.utilities = {
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
POLYFILL EVENT EMITTER
*/
var indexOf;

if (typeof Array.prototype.indexOf === 'function') {
  indexOf = function(haystack, needle) {
    return haystack.indexOf(needle);
  };
} else {
  indexOf = function(haystack, needle) {
    var i = 0,
      length = haystack.length,
      idx = -1,
      found = false;

    while (i < length && !found) {
      if (haystack[i] === needle) {
        idx = i;
        found = true;
      }

      i++;
    }

    return idx;
  };
};


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
    idx = indexOf(this.events[event], listener);

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

    for (i = 0; i < length; i++) {
      listeners[i].apply(this, args);
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