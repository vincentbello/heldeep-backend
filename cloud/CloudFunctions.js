var Episode = Parse.Object.extend('Episode'),
    Track = Parse.Object.extend('Track');

var SoundCloud = {
  FetchTracksUrl: 'https://api.soundcloud.com/users/heldeepradio/tracks.json',
  ClientId: '20c0a4e42940721a64391ac4814cc8c7',
  TracksLimit: 200
};

var SpecialTrackTypesRegex = /Heldeep Radio Cooldown|Heldeep Cooldown|Heldeep Radio Classic|Heldeep Classic|Heldeep Radio Halfbeat|Heldeep Halfbeat/;

/**
 * Format episode object from SC data
 * @param  {Object} ep : episode object
 * @return {Object}    formatted episode
 */
function generateEpisodeObject(ep) {
  var epId = getEpisodeId(ep.title);
  return {
    epId: epId,
    scId: ep.id,
    scCreatedAt: ep.created_at,
    title: ep.title,
    description: ep.description,
    duration: ep.duration,
    purchaseUrl: ep.purchase_url,
    streamUrl: ep.stream_url,
    permalinkUrl: ep.permalink_url
  };
}

/**
 * Gets episode ID (number) from episode title
 * @param  {String} title : episode title
 * @return {Number}       episode ID
 */
function getEpisodeId(title) {
  var matches = title.match(/#[0-9]{3}/);
  if (!matches) {
    console.error('Couldn\'t find an episode ID match for: ', title);
    return;
  }
  return parseInt(matches[0].substring(1), 10);
}

/**
 * Gets array of track objects from episode description
 * @param  {String} description : episode description
 * @param  {Number} parentEpId  : episode ID
 * @return {Array}              array of track objects
 */
function getTracks(description, parentEpId) {
  var arr = description.split(/[^0-9][0-9]{1,2}[.)] /),
      tlen,
      i,
      tracksArr = [],
      trackObj,
      specialMatch,
      isSpecial = false;

  arr.shift(); // Remove first element, which is never a track
  tlen = arr.length;

  for (i = 0; i < tlen; i++) {
    trackObj = {
      type: isSpecial ? specialMatch : null,
      episode: parentEpId,
      order: i + 1
    };
    specialMatch = arr[i].match(SpecialTrackTypesRegex);
    if (specialMatch) {
      specialMatch = specialMatch[0];
      arr[i] = arr[i].replace(specialMatch, '');
      isSpecial = true;
    } else {
      isSpecial = false;
    }
    trackObj.title = arr[i];
    tracksArr.push(trackObj);
  }

  return tracksArr;
}


function parseTime(timeStr) {
  if (!timeStr) {
    return null;
  }
  if (timeStr.indexOf('min') !== -1) {
    return parseInt(timeStr.replace('min', ''), 10) * 60;
  } else {
    var timeArr = timeStr.split(':');
    timeArr.slice(Math.max(0, timeArr.length - 3));
    timeArr = timeArr.map(function(n) { return parseInt(n, 10) || 0; });
    switch (timeArr.length) {
      case 1:
        return timeArr[0];
      case 2:
        return timeArr[0] * 60 + timeArr[1];
      case 3:
        return timeArr[0] * 3600 + timeArr[1] * 60 + timeArr[2];
      default:
        return null;
    }
  }
}

// Cloud function to fetch all episodes and populate all data (should not be run anymore)
Parse.Cloud.define('fetchAll', function(request, response) {
  var data,
      episode = {},
      epObj,
      tracksArray = [],
      toSave = [];

  Parse.Cloud.httpRequest({
    url: SoundCloud.FetchTracksUrl,
    params: {
      limit: SoundCloud.TracksLimit,
      client_id: SoundCloud.ClientId
    }
  }).then(function(httpResponse) {
    // success
    data = httpResponse.data;

    data.forEach(function(episode) {
      epObj = generateEpisodeObject(episode);

      var episodeParseObj = new Episode();

      episodeParseObj.set('epId',         epObj.epId);
      episodeParseObj.set('scId',         epObj.scId);
      episodeParseObj.set('scCreatedAt',  epObj.scCreatedAt);
      episodeParseObj.set('title',        epObj.title);
      episodeParseObj.set('description',  epObj.description);
      episodeParseObj.set('duration',     epObj.duration);
      episodeParseObj.set('purchaseUrl',  epObj.purchaseUrl);
      episodeParseObj.set('streamUrl',    epObj.streamUrl);
      episodeParseObj.set('permalinkUrl', epObj.permalinkUrl);

      tracksArray = getTracks(episode.description, epObj.epId);
      tracksArray.forEach(function(trackObj) {

        var trackParseObj = new Track();

        trackParseObj.set('title',   trackObj.title);
        trackParseObj.set('type',    trackObj.type);
        trackParseObj.set('order',   trackObj.order);
        trackParseObj.set('episode', episodeParseObj);

        toSave.push(trackParseObj);
      });
    });

    return Parse.Object.saveAll(toSave);

  }).then(function(objs) {
    response.success('Saved all episodes & tracks.');
  }, function(err) {
    response.error(err);
  });
});

/**
 * Cloud function to set timestamps for a certain episode.
 * Arguments:
 * {String} epId         : episode ID
 * {String} tracklistURL : 1001tracklists URL to parse
 */
Parse.Cloud.define('setTimestamps', function(request, response) {
  var epId = parseInt(request.params.epId, 10),
      tracklistUrl = request.params.tracklistUrl,
      data,
      results,
      order,
      timestamp,
      timestampObj = {},
      responseStr = '';

  Parse.Cloud.httpRequest({
    url: 'https://api.import.io/store/connector/_magic?url=' + encodeURIComponent(tracklistUrl) + '&format=JSON&js=false&infiniteScrollPages=0&_apikey=defddb31353f4930993f61643f76321696f3f7ce7836958aedae0a638bed8a2c55c38aeacf17c63fd3016104560c212a1ed5983422d40d5e5737ea37c407d6c3af2ca0a8c366af8584ab15368408e33a'
  }).then(function(httpResponse) {
    var promise = new Parse.Promise();
    // Success
    data = httpResponse.data;
    results = data.tables[0].results;
    if (results) {
      results.forEach(function(res) {
        order = parseInt(res['tlfontlarge_number/_source'], 10) || undefined;
        timestamp = order ? parseTime(res['cuevaluefield_value']) : null;
        timestampObj[String(order)] = timestamp;
      });

      responseStr = timestampObj;

      promise.resolve(timestampObj);

      return promise;
    }

  }).then(function(obj) {
    // obj is the object of timestamps
    // Find episode first
    var query = new Parse.Query(Episode);
    query.equalTo('epId', epId);
    return query.first();
  }).then(function(episode) {
    var query = new Parse.Query(Track);
    query.equalTo('episode', episode);
    return query.find();
  }).then(function(tracks) {
    var toSave = [],
        order,
        timestamp;

    tracks.forEach(function(track) {
      order = track.get('order');
      timestamp = timestampObj[String(order)] || null;
      track.set('timestamp', timestamp);

      if (timestamp) {
        toSave.push(track);
      }
    });

    return Parse.Object.saveAll(toSave);
  }).then(function(objs) {
    response.success('Success! ' + objs.length);
  });
});

Parse.Cloud.define('removeEmptyEpisodePointers', function(request, response) {
  var numTracks = 0;
  var trackQuery = new Parse.Query(Track);
  var episodeQuery = new Parse.Query(Episode);
  trackQuery.doesNotMatchKeyInQuery('episode', 'objectId', episodeQuery);
  trackQuery.limit(1000);
  trackQuery.find().then(function(tracks) {
    if (tracks.length) {
      numTracks = tracks.length;
      return Parse.Object.destroyAll(tracks);
    } else {
      response.success('No tracks pointing to empty objects.');
    }
  }, function(error) {
    response.error('Could not find tracks pointing to empty objects.');
  }).then(function() {
    response.success('All ' + numTracks + ' tracks pointing to empty objects were deleted.');
  }, function(err) {
    response.error('Could not delete tracks.');
  });
});

Parse.Cloud.define('notifyUsers', function(request, response) {
  var query = new Parse.Query(Parse.Installation);
  Parse.Push.send({
    where: query,
    data: {
      alert: 'It\'s that time of the week again – Heldeep #87 is out!'
    }
  }, {
    success: function() {
      response.success('Successfully sent notification.');
    },
    error: function() {
      response.error('Unsuccessfully sent notification.')
    }
  });
});

