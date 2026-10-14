// Anonymous availability intake for the Yoshinogari festival shift page.
// Only a display name and time ranges are returned to the public page.
var DAY_WINDOWS = {
  d23: ['09:00', '14:00'],
  d24: ['09:00', '21:00'],
  d25: ['09:00', '21:00']
};
var MAX_MEMBERS = 200;
var MAX_POSTS = 200;

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action !== 'list') {
    return ContentService.createTextOutput('Availability service is running.');
  }
  var records = listRecords_().map(function (record) {
    return {
      id: record.id,
      name: record.name,
      avail: record.avail,
      updated: record.updated
    };
  });
  var posts = listPosts_().map(function (post) { return { id: post.id, name: post.name, message: post.message, created: post.created }; });
  return ContentService
    .createTextOutput('window.hmReceiveAvailability(' + JSON.stringify({ members: records, posts: posts }) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  try {
    var raw = e && e.parameter && e.parameter.payload;
    if (!raw || raw.length > 6000) throw new Error('Invalid payload');
    var input = JSON.parse(raw);
    if (input.website) return ContentService.createTextOutput('OK'); // Honeypot.
    if (input.kind === 'post') return savePost_(input);
    var record = validateRecord_(input);
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var store = PropertiesService.getScriptProperties();
      var key = 'member:' + record.id;
      var existingRaw = store.getProperty(key);
      if (existingRaw) {
        var existing = JSON.parse(existingRaw);
        if (existing.tokenHash !== record.tokenHash) throw new Error('Edit key does not match');
      } else if (listRecords_().length >= MAX_MEMBERS) {
        throw new Error('Member limit reached');
      }
      store.setProperty(key, JSON.stringify(record));
    } finally {
      lock.releaseLock();
    }
    return ContentService.createTextOutput('OK');
  } catch (err) {
    console.error(String(err));
    return ContentService.createTextOutput('ERROR');
  }
}


function savePost_(input) {
  var id = String(input.id || '');
  var memberId = String(input.memberId || '');
  var token = String(input.token || '');
  var message = String(input.message || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(memberId) || !/^[0-9a-f-]{36}$/i.test(token)) throw new Error('Invalid post key');
  if (!message || message.length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) throw new Error('Invalid message');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var store = PropertiesService.getScriptProperties();
    var memberRaw = store.getProperty('member:' + memberId);
    if (!memberRaw) throw new Error('Member is not registered');
    var member = JSON.parse(memberRaw);
    if (member.tokenHash !== sha256_(token)) throw new Error('Edit key does not match');
    if (listPosts_().length >= MAX_POSTS) throw new Error('Post limit reached');
    if (store.getProperty('post:' + id)) throw new Error('Duplicate post');
    store.setProperty('post:' + id, JSON.stringify({
      id: id, name: member.name, message: message, created: new Date().toISOString()
    }));
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput('OK');
}

function listPosts_() {
  var values = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(values).filter(function (key) { return key.indexOf('post:') === 0; })
    .map(function (key) { try { return JSON.parse(values[key]); } catch (_) { return null; } })
    .filter(function (post) { return post && post.id && post.name && post.message; })
    .sort(function (a, b) { return a.created < b.created ? 1 : a.created > b.created ? -1 : 0; });
}

function validateRecord_(input) {
  var id = String(input.id || '');
  var token = String(input.token || '');
  var name = String(input.name || '').trim().replace(/\s+/g, ' ');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(token)) throw new Error('Invalid edit key');
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Invalid name');

  var avail = {};
  var count = 0;
  Object.keys(DAY_WINDOWS).forEach(function (dayId) {
    var ranges = (input.avail || {})[dayId] || [];
    if (!Array.isArray(ranges) || ranges.length > 4) throw new Error('Invalid ranges');
    var minStart = timeToMin_(DAY_WINDOWS[dayId][0]);
    var maxEnd = timeToMin_(DAY_WINDOWS[dayId][1]);
    var lastEnd = minStart;
    avail[dayId] = ranges.map(function (range) {
      if (!Array.isArray(range) || range.length !== 2) throw new Error('Invalid range');
      var start = String(range[0]);
      var end = String(range[1]);
      if (!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(start) || !/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(end)) throw new Error('Invalid time');
      var a = timeToMin_(start);
      var b = timeToMin_(end);
      if (a < minStart || b > maxEnd || a >= b || a < lastEnd) throw new Error('Overlapping or out of bounds range');
      lastEnd = b;
      count++;
      return [start, end];
    });
  });
  if (!count) throw new Error('Choose at least one time range');
  return {
    id: id,
    name: name,
    avail: avail,
    tokenHash: sha256_(token),
    updated: new Date().toISOString()
  };
}

function timeToMin_(value) {
  var parts = value.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function sha256_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); })
    .join('');
}

function listRecords_() {
  var values = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(values).filter(function (key) { return key.indexOf('member:') === 0; })
    .map(function (key) { try { return JSON.parse(values[key]); } catch (_) { return null; } })
    .filter(function (record) { return record && record.id && record.name; })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
}

// The owner can remove an unwanted entry by running this function in the editor.
function removeMemberById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('Invalid id');
  PropertiesService.getScriptProperties().deleteProperty('member:' + id);
}

function healthCheck() {
  console.log('Members: ' + listRecords_().length);
}
