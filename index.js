const express = require('express');
const https   = require('https');
require('dotenv').config();

const HUBSPOT_KEY      = process.env.HUBSPOT_KEY;

const BASE_URL         = 'https://api.hubapi.com/content/api/v2/blog-posts';
const VALIDATION_PARAM = 'hapikey=' + HUBSPOT_KEY;
const API_PARAMS       = [
  'archived=false',
  'state=PUBLISHED',
  'order_by=-publish_date',
  'content_group_id=2125467268'
];

const ALLOWED_DOMAINS  = ['hs-sites.com', 'tradegecko.com'];
const CACHE_LIFESPAN   = 1000 * 60 * 60 * 6; // 6 hours

const APP             = express();
const CACHED_SEARCHES = {};


APP.get('/', domainCheck,
             setHeaders,
             ensureSearchTermExists,
             checkForCachedResults,
             initiateSearch);

APP.listen(process.env.PORT, function () {
  console.log(`Listening on port ${ process.env.PORT }!`);
});

setInterval(pruneCache, CACHE_LIFESPAN / 4);


// Deal with a request
function domainCheck(req, res, next) {
  let domain = req.headers.origin &&
               req.headers.origin.split('//')[1].split('/')[0].split('.').slice(-2).join('.');

  if (ALLOWED_DOMAINS.includes(domain)) {
    next();
  } else {
    res.status(401)
       .send({ errors: ['Access not allowed.'] });
  }
}

function setHeaders(req, res, next) {
  res.header({
    'Access-Control-Allow-Origin':  req.headers.origin,
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  next();
}

function ensureSearchTermExists(req, res, next) {
  let searchTerm = req.query.q;

  if (!req.query.q) {
    res.status(400)
       .send({ errors: ['No search term provided.'] });

    console.log('No search term provided.');
  } else {
    next();
  }
}

function checkForCachedResults(req, res, next) {
  let searchTerm = req.query.q;

  if (CACHED_SEARCHES[searchTerm]) {
    res.status(200)
       .send(CACHED_SEARCHES[searchTerm].data);

    console.log(`Returned cached results for: ${ searchTerm }`);
  } else {
    next();
  }
}

function initiateSearch(req, res) {
  let searchTerm = req.query.q;
  let searchURL  = buildAPICall(searchTerm);

  https.get(searchURL, httpsRes => {
    let contentType = httpsRes.headers['content-type'];

    let error;
    if (httpsRes.statusCode !== 200) {
      error = `Request Failed. Status Code: ${ httpsRes.statusCode }`;
    } else if (!/^application\/json/.test(contentType)) {
      error = `Invalid content-type. Expected application/json but received ${ contentType }`;
    }
    if (error) {
      reject(error.message);
      httpsRes.resume();
      return;
    }

    let rawData = '';
    httpsRes.setEncoding('utf8');
    httpsRes.on('data', chunk => {
      rawData += chunk;
    });
    httpsRes.on('end', () => {
      try {
        const parsedData = JSON.parse(rawData);
        resolve(parsedData);
      } catch (e) {
        reject(e.message);
      }
    });
  }).on('error', e => {
    reject(e.message);
  });

  function resolve(data) {
    CACHED_SEARCHES[searchTerm] = {
      data,
      ts: +new Date(),
    };
    res.status(200)
       .send(data);

    console.log(`Cached and returned found results for: ${ searchTerm }`);
  }

  function reject (error) {
    res.status(502)
       .send({ errors: [ error ] });

    console.log(`Errored out at: ${ error }`);
  }
}


// Utility functions
function pruneCache() {
  let currentTime = +new Date();

  Object.keys(CACHED_SEARCHES).forEach(searchTerm => {
    if (currentTime - CACHED_SEARCHES[searchTerm].ts > CACHE_LIFESPAN) {
      delete CACHED_SEARCHES[searchTerm];
    }
  });
}

function buildAPICall(searchTerm) {
  let searchParam = `name__icontains=${ searchTerm }`;
  return `${ BASE_URL }?${ [VALIDATION_PARAM, searchParam, ...API_PARAMS].join('&') }`;
}
