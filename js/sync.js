// Data synchronization module — syncs localStorage with Supabase
const Sync = (() => {
  var LAST_SYNC_KEY = 'shotsy_last_sync';
  var CLOUD_USER_KEY = 'shotsy_cloud_user_id';
  var SYNC_RESUME_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Map localStorage keys to Supabase table names
  var KEY_TABLE_MAP = {
    shotsy_weights: 'weights',
    shotsy_jabs: 'jabs',
    shotsy_victories: 'victories',
    shotsy_measurements: 'measurements',
    shotsy_journal: 'journal',
    shotsy_fasts: 'fasts',
    shotsy_exercises: 'exercises',
    shotsy_profile: 'profiles',
    shotsy_goals: 'goals',
    shotsy_settings: 'settings',
  };

  // Collection tables (arrays of items with id)
  var COLLECTION_TABLES = ['weights', 'jabs', 'victories', 'measurements', 'journal', 'fasts', 'exercises'];

  // Singleton tables (single object per user)
  var SINGLETON_TABLES = ['profiles', 'goals', 'settings'];

  // Store getters/savers for each table
  var STORE_MAP = {
    weights:      { get: function () { return Store.getWeights(); },      save: function (d) { Store.saveWeights(d); } },
    jabs:         { get: function () { return Store.getJabs(); },         save: function (d) { Store.saveJabs(d); } },
    victories:    { get: function () { return Store.getVictories(); },    save: function (d) { Store.saveVictories(d); } },
    measurements: { get: function () { return Store.getMeasurements(); }, save: function (d) { Store.saveMeasurements(d); } },
    journal:      { get: function () { return Store.getJournal(); },      save: function (d) { Store.saveJournal(d); } },
    fasts:        { get: function () { return Store.getFasts(); },        save: function (d) { Store.saveFasts(d); } },
    exercises:    { get: function () { return Store.getExercises(); },    save: function (d) { Store.saveExercises(d); } },
    profiles:     { get: function () { return Store.getProfile(); },      save: function (d) { Store.saveProfile(d); } },
    goals:        { get: function () { return Store.getGoals(); },        save: function (d) { Store.saveGoals(d); } },
    settings:     { get: function () { return Store.getSettings(); },     save: function (d) { Store.saveSettings(d); } },
  };

  // camelCase ↔ snake_case helpers
  function toSnake(str) {
    return str.replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); });
  }
  function toCamel(str) {
    return str.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); });
  }
  function keysToSnake(obj) {
    var out = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        out[toSnake(k)] = obj[k];
      }
    }
    return out;
  }
  function keysToCamel(obj) {
    var out = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        out[toCamel(k)] = obj[k];
      }
    }
    return out;
  }

  function getClient() {
    return Auth.getClient();
  }

  function getUserId() {
    var user = Auth.getUser();
    return user ? user.id : null;
  }

  // --- Collection sync (arrays with id) ---

  function pushCollection(table, items) {
    var client = getClient();
    var userId = getUserId();
    if (!client || !userId || !items || items.length === 0) return Promise.resolve();

    var rows = items.map(function (item) {
      var row = keysToSnake(item);
      row.user_id = userId;
      row.updated_at = row.updated_at || new Date().toISOString();
      // side_effects should be JSON array
      if (row.side_effects && typeof row.side_effects === 'object') {
        row.side_effects = JSON.stringify(row.side_effects);
      }
      return row;
    });

    return client.from(table).upsert(rows, { onConflict: 'user_id,id' })
      .then(function (result) {
        if (result.error) console.error('[Sync] Push ' + table + ' error:', result.error);
        return result;
      });
  }

  function pullCollection(table) {
    var client = getClient();
    var userId = getUserId();
    if (!client || !userId) return Promise.resolve({ active: [], tombstoneIds: [] });

    return client.from(table).select('*').eq('user_id', userId)
      .then(function (result) {
        if (result.error) {
          console.error('[Sync] Pull ' + table + ' error:', result.error);
          return { active: [], tombstoneIds: [] };
        }
        var active = [];
        var tombstoneIds = [];
        (result.data || []).forEach(function (row) {
          if (row.deleted_at) {
            tombstoneIds.push(row.id);
          } else {
            var item = keysToCamel(row);
            delete item.userId;
            delete item.deletedAt;
            // Parse side_effects back to array
            if (item.sideEffects && typeof item.sideEffects === 'string') {
              try { item.sideEffects = JSON.parse(item.sideEffects); } catch (e) { item.sideEffects = []; }
            }
            active.push(item);
          }
        });
        return { active: active, tombstoneIds: tombstoneIds };
      });
  }

  function mergeCollection(localItems, remoteActive, tombstoneIds) {
    var localMap = {};
    var remoteMap = {};
    var tombstoneSet = {};

    tombstoneIds.forEach(function (id) { tombstoneSet[id] = true; });
    localItems.forEach(function (item) { localMap[item.id] = item; });
    remoteActive.forEach(function (item) { remoteMap[item.id] = item; });

    var merged = {};

    // Add local items not tombstoned
    for (var id in localMap) {
      if (!tombstoneSet[id]) merged[id] = localMap[id];
    }

    // Merge remote items
    for (var rid in remoteMap) {
      if (tombstoneSet[rid]) continue;
      if (merged[rid]) {
        // Both exist — last-write-wins by updated_at
        var localTime = merged[rid].updatedAt ? new Date(merged[rid].updatedAt).getTime() : 0;
        var remoteTime = remoteMap[rid].updatedAt ? new Date(remoteMap[rid].updatedAt).getTime() : 0;
        if (remoteTime >= localTime) {
          merged[rid] = remoteMap[rid];
        }
      } else {
        merged[rid] = remoteMap[rid];
      }
    }

    return Object.keys(merged).map(function (k) { return merged[k]; });
  }

  // --- Singleton sync (profile, goals, settings) ---

  function pushSingleton(table, data) {
    var client = getClient();
    var userId = getUserId();
    if (!client || !userId) return Promise.resolve();

    var row;
    if (table === 'settings') {
      // Settings stored as JSONB blob
      row = { user_id: userId, data: data, updated_at: new Date().toISOString() };
    } else {
      row = keysToSnake(data);
      row.user_id = userId;
      row.updated_at = new Date().toISOString();
    }

    return client.from(table).upsert(row, { onConflict: 'user_id' })
      .then(function (result) {
        if (result.error) console.error('[Sync] Push ' + table + ' error:', result.error);
        return result;
      });
  }

  function pullSingleton(table) {
    var client = getClient();
    var userId = getUserId();
    if (!client || !userId) return Promise.resolve(null);

    return client.from(table).select('*').eq('user_id', userId).maybeSingle()
      .then(function (result) {
        if (result.error) {
          console.error('[Sync] Pull ' + table + ' error:', result.error);
          return null;
        }
        if (!result.data) return null;
        if (table === 'settings') {
          return result.data.data || {};
        }
        var item = keysToCamel(result.data);
        delete item.userId;
        return item;
      });
  }

  // --- Photo sync (Supabase Storage + photos metadata table) ---

  var PHOTO_BUCKET = 'photos';

  function photoPath(userId, photoId) {
    return userId + '/' + photoId + '.jpg';
  }

  function thumbPath(userId, photoId) {
    return userId + '/' + photoId + '_thumb.jpg';
  }

  function pushPhoto(photoId) {
    var client = getClient();
    var userId = getUserId();
    if (!client || !userId) return Promise.resolve();

    return Store.getPhotoRecord(photoId).then(function (record) {
      if (!record || !record.blob) return;

      var fullPath = photoPath(userId, photoId);
      var tPath = thumbPath(userId, photoId);

      // Upload full image and thumbnail in parallel
      var uploads = [
        client.storage.from(PHOTO_BUCKET).upload(fullPath, record.blob, {
          contentType: 'image/jpeg', upsert: true
        }),
      ];
      if (record.thumbBlob) {
        uploads.push(
          client.storage.from(PHOTO_BUCKET).upload(tPath, record.thumbBlob, {
            contentType: 'image/jpeg', upsert: true
          })
        );
      }

      return Promise.all(uploads).then(function (results) {
        var hasError = results.some(function (r) { return r.error; });
        if (hasError) {
          console.error('[Sync] Photo upload error:', results.map(function (r) { return r.error; }));
          return;
        }

        // Upsert metadata row
        var row = {
          user_id: userId,
          id: photoId,
          date: record.date,
          note: record.note || '',
          storage_path: fullPath,
          thumb_path: tPath,
          content_hash: record.contentHash || null,
          updated_at: new Date().toISOString(),
        };

        return client.from('photos').upsert(row, { onConflict: 'user_id,id' }).then(function (result) {
          if (result.error) {
            console.error('[Sync] Photo metadata push error:', result.error);
            return;
          }
          return Store.markPhotoSynced(photoId);
        });
      });
    });
  }

  function deletePhotoRemote(photoId) {
    var client = getClient();
    var userId = getUserId();
    if (!client || !userId) return Promise.resolve();

    var fullPath = photoPath(userId, photoId);
    var tPath = thumbPath(userId, photoId);

    return Promise.all([
      client.storage.from(PHOTO_BUCKET).remove([fullPath, tPath]),
      client.from('photos').update({ deleted_at: new Date().toISOString() })
        .eq('user_id', userId).eq('id', photoId),
    ]).then(function (results) {
      if (results[0].error) console.error('[Sync] Photo storage delete error:', results[0].error);
      if (results[1].error) console.error('[Sync] Photo metadata delete error:', results[1].error);
    });
  }

  function pullPhotoMetadata() {
    var client = getClient();
    var userId = getUserId();
    if (!client || !userId) return Promise.resolve({ active: [], tombstoneIds: [] });

    return client.from('photos').select('*').eq('user_id', userId).then(function (result) {
      if (result.error) {
        console.error('[Sync] Pull photo metadata error:', result.error);
        return { active: [], tombstoneIds: [] };
      }
      var active = [];
      var tombstoneIds = [];
      (result.data || []).forEach(function (row) {
        if (row.deleted_at) {
          tombstoneIds.push(row.id);
        } else {
          active.push(keysToCamel(row));
        }
      });
      return { active: active, tombstoneIds: tombstoneIds };
    });
  }

  function downloadPhotoBlob(storagePath) {
    var client = getClient();
    if (!client) return Promise.resolve(null);
    return client.storage.from(PHOTO_BUCKET).download(storagePath).then(function (result) {
      if (result.error) {
        console.error('[Sync] Photo download error:', result.error);
        return null;
      }
      return result.data;
    });
  }

  function syncPhotos() {
    if (!Auth.isLoggedIn()) return Promise.resolve();

    return Promise.all([
      Store.getPhotos(),
      pullPhotoMetadata(),
    ]).then(function (results) {
      var localPhotos = results[0];
      var remote = results[1];
      var remoteActive = remote.active;
      var tombstoneIds = remote.tombstoneIds;
      var tombstoneSet = {};
      tombstoneIds.forEach(function (id) { tombstoneSet[id] = true; });

      var localMap = {};
      localPhotos.forEach(function (p) { localMap[p.id] = p; });

      var remoteMap = {};
      remoteActive.forEach(function (p) { remoteMap[p.id] = p; });

      var promises = [];

      // Push local photos that aren't synced yet
      localPhotos.forEach(function (photo) {
        if (tombstoneSet[photo.id]) return; // remotely deleted
        if (!photo.syncedAt) {
          promises.push(pushPhoto(photo.id));
        }
      });

      // Pull remote photos not in local
      remoteActive.forEach(function (remoteMeta) {
        if (localMap[remoteMeta.id]) return; // already local
        // Download full + thumb and save locally
        promises.push(
          Promise.all([
            downloadPhotoBlob(remoteMeta.storagePath),
            remoteMeta.thumbPath ? downloadPhotoBlob(remoteMeta.thumbPath) : Promise.resolve(null),
          ]).then(function (blobs) {
            var fullBlob = blobs[0];
            var tBlob = blobs[1];
            if (!fullBlob) return;
            return Store.savePhotoFromRemote({
              id: remoteMeta.id,
              date: remoteMeta.date,
              note: remoteMeta.note || '',
              blob: fullBlob,
              thumbBlob: tBlob || fullBlob,
              contentHash: remoteMeta.contentHash || null,
              syncedAt: new Date().toISOString(),
            });
          })
        );
      });

      // Delete local photos that were remotely tombstoned
      tombstoneIds.forEach(function (id) {
        if (localMap[id]) {
          promises.push(Store.deletePhoto(id));
        }
      });

      return Promise.all(promises);
    });
  }

  function pushAllPhotos() {
    if (!Auth.isLoggedIn()) return Promise.resolve();
    return Store.getPhotos().then(function (photos) {
      var unsynced = photos.filter(function (p) { return !p.syncedAt; });
      if (unsynced.length === 0) return;
      return Promise.all(unsynced.map(function (p) { return pushPhoto(p.id); }));
    });
  }

  // --- Full sync operations ---

  function pushAll() {
    if (!Auth.isLoggedIn()) return Promise.resolve();

    var promises = [];
    COLLECTION_TABLES.forEach(function (table) {
      var items = STORE_MAP[table].get();
      if (items && items.length > 0) {
        promises.push(pushCollection(table, items));
      }
    });
    SINGLETON_TABLES.forEach(function (table) {
      var data = STORE_MAP[table].get();
      if (data) {
        promises.push(pushSingleton(table, data));
      }
    });

    // Also push unsynced photos
    promises.push(pushAllPhotos());

    return Promise.all(promises).then(function () {
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    });
  }

  function pullAll() {
    if (!Auth.isLoggedIn()) return Promise.resolve();

    var collectionPromises = COLLECTION_TABLES.map(function (table) {
      return pullCollection(table).then(function (result) {
        var localItems = STORE_MAP[table].get();
        var merged = mergeCollection(localItems, result.active, result.tombstoneIds);
        STORE_MAP[table].save(merged);
      });
    });

    var singletonPromises = SINGLETON_TABLES.map(function (table) {
      return pullSingleton(table).then(function (remote) {
        if (remote) {
          // Merge with local data so local-only fields (e.g. current dose,
          // reminder toggles) are preserved instead of being cleared.
          var local = STORE_MAP[table].get();
          var merged = local ? Object.assign({}, local, remote) : remote;
          // Preserve non-empty local values that remote would clear
          if (local) {
            Object.keys(local).forEach(function (key) {
              if (local[key] && !remote[key]) {
                merged[key] = local[key];
              }
            });
          }
          STORE_MAP[table].save(merged);
        }
      });
    });

    return Promise.all(collectionPromises.concat(singletonPromises)).then(function () {
      // Sync photos after other data
      return syncPhotos();
    }).then(function () {
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    });
  }

  function mergeOnSignIn() {
    if (!Auth.isLoggedIn()) return Promise.resolve();
    var userId = getUserId();

    // Check if remote has any data
    return pullSingleton('profiles').then(function (remoteProfile) {
      var hasRemoteData = remoteProfile && remoteProfile.name;
      var localProfile = Store.getProfile();
      var hasLocalData = localProfile && localProfile.name;

      if (!hasRemoteData && hasLocalData) {
        // New account — push all local data up
        return pushAll();
      } else if (hasRemoteData && !hasLocalData) {
        // Returning user on new device — pull everything
        return pullAll();
      } else if (hasRemoteData && hasLocalData) {
        // Both have data — bidirectional merge
        return pullAll().then(function () {
          return pushAll();
        });
      }
      // Neither has data — nothing to do
    }).then(function () {
      localStorage.setItem(CLOUD_USER_KEY, userId);
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    });
  }

  // --- Debounced mutation sync ---

  var syncTimers = {};
  var _paused = false;

  function pauseSync() { _paused = true; }
  function resumeSync() { _paused = false; }

  function handleStoreMutation(e) {
    if (_paused || !Auth.isLoggedIn()) return;
    var key = e.detail.key;

    // Handle photo mutations separately
    if (key === 'shotsy_photos') {
      var photoId = e.detail.photoId;
      if (!photoId) return;
      clearTimeout(syncTimers['photo_' + photoId]);
      syncTimers['photo_' + photoId] = setTimeout(function () {
        if (e.detail.deleted) {
          deletePhotoRemote(photoId).catch(function (err) {
            console.error('[Sync] Photo delete sync failed:', err);
          });
        } else {
          pushPhoto(photoId).catch(function (err) {
            console.error('[Sync] Photo push failed:', err);
          });
        }
      }, 2000);
      return;
    }

    var table = KEY_TABLE_MAP[key];
    if (!table) return;

    clearTimeout(syncTimers[table]);
    syncTimers[table] = setTimeout(function () {
      if (COLLECTION_TABLES.indexOf(table) !== -1) {
        var items = STORE_MAP[table].get();
        pushCollection(table, items).catch(function (err) {
          console.error('[Sync] Debounced push failed:', err);
        });
      } else {
        var data = STORE_MAP[table].get();
        pushSingleton(table, data).catch(function (err) {
          console.error('[Sync] Debounced push failed:', err);
        });
      }
    }, 2000);
  }

  function markDeleted(table, itemId) {
    var client = getClient();
    var userId = getUserId();
    if (!client || !userId) return Promise.resolve();

    return client.from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('id', itemId)
      .then(function (result) {
        if (result.error) console.error('[Sync] markDeleted error:', result.error);
      });
  }

  // --- Sync on resume ---

  function syncOnResume() {
    if (!Auth.isLoggedIn()) return;
    var lastSync = localStorage.getItem(LAST_SYNC_KEY);
    if (lastSync && (Date.now() - new Date(lastSync).getTime()) < SYNC_RESUME_INTERVAL) return;
    pullAll().catch(function (err) {
      console.error('[Sync] Resume sync failed:', err);
    });
  }

  // --- Init: listen for store-mutation events ---

  function init() {
    window.addEventListener('store-mutation', handleStoreMutation);
  }

  function getLastSyncTime() {
    return localStorage.getItem(LAST_SYNC_KEY);
  }

  return {
    init: init,
    pushAll: pushAll,
    pullAll: pullAll,
    mergeOnSignIn: mergeOnSignIn,
    markDeleted: markDeleted,
    syncOnResume: syncOnResume,
    getLastSyncTime: getLastSyncTime,
    pauseSync: pauseSync,
    resumeSync: resumeSync,
    syncPhotos: syncPhotos,
    pushPhoto: pushPhoto,
    deletePhotoRemote: deletePhotoRemote,
    downloadPhotoBlob: downloadPhotoBlob,
  };
})();
