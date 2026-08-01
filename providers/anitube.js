/**
 * Anitube - Nuvio Provider (Port of Stremio Addon Logic)
 */
"use strict";

var TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
var BASE_URL = "https://www.anitube.zip";
var PROVIDER_TAG = "Anitube";
var PROVIDER_VERSION = "4.0.0";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36";

var __async = function (__this, __arguments, generator) {
  return new Promise(function (resolve, reject) {
    var fulfilled = function (v) { try { step(generator.next(v)); } catch (e) { reject(e); } };
    var rejected = function (v) { try { step(generator.throw(v)); } catch (e) { reject(e); } };
    var step = function (x) { return x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected); };
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

function fetchText(url, opts) {
  if (!opts) opts = {};
  return __async(this, null, function* () {
    try {
      var r = yield fetch(url, {
        method: opts.method || "GET",
        redirect: "follow",
        headers: Object.assign({
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9",
          "Referer": BASE_URL + "/"
        }, opts.headers || {})
      });
      return { status: r.status, text: yield r.text() };
    } catch (e) { return { status: -1, text: "" }; }
  });
}

function fetchJson(url, opts) {
  if (!opts) opts = {};
  return __async(this, null, function* () {
    try {
      var r = yield fetch(url, {
        method: opts.method || "GET",
        redirect: "follow",
        headers: Object.assign({
          "User-Agent": USER_AGENT,
          Accept: "application/json, */*",
          "Accept-Language": "pt-BR,pt;q=0.9"
        }, opts.headers || {})
      });
      var t = yield r.text();
      try { return { status: r.status, data: JSON.parse(t) }; }
      catch (e) { return { status: r.status, data: null, raw: t }; }
    } catch (e) { return { status: -1, data: null }; }
  });
}

// ─────────────────────────────────────────────
// Similarity & String utilities (from Stremio addon)
// ─────────────────────────────────────────────
function normalize(s) {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/[:\-–—]/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\b(the|a|an|no|wo|wa|ga|de|ni|to)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s) {
  var words = s.split(' ').filter(Boolean);
  if (words.length === 1) return words;
  var out = [];
  for (var i = 0; i < words.length - 1; i++) {
    out.push(words[i] + ' ' + words[i + 1]);
  }
  return out;
}

function similarity(a, b) {
  var na = normalize(a);
  var nb = normalize(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;

  if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) {
    return Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
  }

  var arrA = na.split(' ').filter(Boolean);
  var arrB = nb.split(' ').filter(Boolean);
  var setB = {};
  for(var i=0; i<arrB.length; i++) setB[arrB[i]] = 1;
  
  var wordInter = 0;
  var setA = {};
  var sizeA = 0;
  for(var j=0; j<arrA.length; j++) {
      if (!setA[arrA[j]]) {
          setA[arrA[j]] = 1;
          sizeA++;
          if (setB[arrA[j]]) wordInter++;
      }
  }
  var sizeB = 0;
  for (var key in setB) sizeB++;

  var jaccard = wordInter / (sizeA + sizeB - wordInter);

  var bgAArr = bigrams(na);
  var bgBArr = bigrams(nb);
  var bgBSet = {};
  var bgBSize = 0;
  for(var k=0; k<bgBArr.length; k++) {
      if(!bgBSet[bgBArr[k]]) { bgBSet[bgBArr[k]] = 1; bgBSize++; }
  }
  var bgInter = 0;
  var bgASet = {};
  var bgASize = 0;
  for(var m=0; m<bgAArr.length; m++) {
      if(!bgASet[bgAArr[m]]) {
          bgASet[bgAArr[m]] = 1;
          bgASize++;
          if (bgBSet[bgAArr[m]]) bgInter++;
      }
  }
  var dice = (bgASize + bgBSize) > 0 ? (2 * bgInter) / (bgASize + bgBSize) : 0;

  return Math.max(jaccard, dice);
}

function buildQueries(title, aliases) {
  var seen = {};
  var jpFirst = [];
  var enLast = [];

  function addTo(arr, s) {
    if (!s || s.length < 2) return;
    var clean = s.trim();
    if (!seen[clean]) { seen[clean] = 1; arr.push(clean); }
  }

  if (aliases && aliases.length > 0) {
    for (var i = 0; i < aliases.length; i++) {
      var a = aliases[i];
      if (typeof a !== 'string') continue;
      addTo(jpFirst, a.split(':')[0].split(' - ')[0].trim());
      addTo(jpFirst, a.trim());
    }
  }

  var t1 = title.replace(/\s*\(Dub\)/i, '').split(':')[0].split(' - ')[0].trim();
  addTo(enLast, t1);
  addTo(enLast, title.replace(/\s*\(Dub\)/i, '').trim());
  addTo(enLast, title);

  return jpFirst.concat(enLast);
}

function buildAllTitles(title, aliases) {
  var titles = {};
  var out = [];

  function add(s) {
    if (s && s.length > 1) {
      var n = normalize(s);
      if (n && !titles[n]) { titles[n] = 1; out.push(n); }
    }
  }

  add(title);
  add(title.replace(/\s*\(Dub\)/i, '').trim());
  add(title.split(':')[0].trim());

  if (aliases && aliases.length > 0) {
    for (var i = 0; i < aliases.length; i++) {
      var a = aliases[i];
      if (typeof a === 'string') {
        add(a);
        add(a.split(':')[0].trim());
      }
    }
  }

  return out;
}

// ─────────────────────────────────────────────
// TMDB
// ─────────────────────────────────────────────
function getTmdbInfo(tmdbId, type) {
  return __async(this, null, function* () {
    var cleanId = String(tmdbId).replace(/[^a-zA-Z0-9]/g, "").replace(/^tmdb/i, ""); 
    var isImdb = cleanId.indexOf("tt") === 0;
    var d = null;
    if (isImdb) {
       var findUrl = "https://api.themoviedb.org/3/find/" + cleanId + "?api_key=" + TMDB_API_KEY + "&external_source=imdb_id&language=pt-BR";
       var fRes = yield fetchJson(findUrl);
       if (!fRes.data) return null;
       var results = (type === "tv" || type === "anime") ? fRes.data.tv_results : fRes.data.movie_results;
       if (results && results.length > 0) d = results[0];
       if (!d) return null;
       cleanId = d.id;
    }
    var path = (type === "tv" || type === "anime") ? "tv" : "movie";
    var base = "https://api.themoviedb.org/3/" + path + "/" + cleanId;
    var ptRes = yield fetchJson(base + "?api_key=" + TMDB_API_KEY + "&language=pt-BR");
    if (!ptRes.data) return null;
    d = ptRes.data;
    var origin = d.origin_country || [];
    var isJapaneseOrigin = d.original_language === "ja" || origin.indexOf("JP") !== -1 || origin.indexOf("JA") !== -1;
    var altTitles = [];
    var altRes = yield fetchJson(base + "/alternative_titles?api_key=" + TMDB_API_KEY);
    if (altRes && altRes.data) {
      var results = altRes.data.results || altRes.data.titles || [];
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (!r || !r.title) continue;
        var c = (r.iso_3166_1 || "").toUpperCase();
        if (c === "JP" || c === "US" || c === "GB" || c === "BR" || c === "PT") {
          altTitles.push(r.title);
        }
      }
    }
    return {
      title: d.title || d.name || "",
      originalTitle: d.original_title || d.original_name || "",
      altTitles: altTitles,
      year: ((d.release_date || d.first_air_date || "").split("-")[0]) || null,
      isAnime: isJapaneseOrigin,
    };
  });
}

// ─────────────────────────────────────────────
// Search & Extract
// ─────────────────────────────────────────────
function searchAnime(query) {
  return __async(this, null, function* () {
    if (!query) return [];
    var url = BASE_URL + "/?s=" + encodeURIComponent(query);
    var res = yield fetchText(url);
    if (res.status === 403 || res.status === 503) return [{ cloudflare: true }];
    if (res.status !== 200 || !res.text) return [];

    var results = [];
    var seen = {};
    var aTagRe = /<a\s+([^>]+)>/gi;
    var m;
    while ((m = aTagRe.exec(res.text)) !== null) {
      var attrs = m[1];
      var hrefMatch = attrs.match(/href=["']((?:https?:\/\/[^\/]+)?\/video\/\d+\/?)["']/i);
      if (hrefMatch) {
        var link = hrefMatch[1];
        if (link.indexOf("http") !== 0) link = BASE_URL + link;
        
        var idMatch = link.match(/\/video\/(\d+)/i);
        if (!idMatch) continue;
        var id = idMatch[1];
        
        if (seen[id]) continue;
        seen[id] = 1;
        
        var titleMatch = attrs.match(/title=["']([^"']+)["']/i);
        var title = titleMatch ? titleMatch[1] : "";
        title = title.replace(/\s*[–\-]\s*Todos os Epis.+$/i, '').trim();

        results.push({ url: link, id: id, name: title });
      }
    }
    return results;
  });
}

function parseEpisodeId(html, targetEp) {
    var epId = null;
    var eps = [];
    
    var containerMatch = html.match(/class=["'][^"']*pagAniListaContainer[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    var targetHtml = containerMatch ? containerMatch[1] : html;

    var aTagRe = /<a\s+([^>]+)>/gi;
    var m;
    var seenLinks = {};

    while ((m = aTagRe.exec(targetHtml)) !== null) {
        var attrs = m[1];
        var hrefMatch = attrs.match(/href=["'](?:https?:\/\/[^\/]+)?\/(?:video\/(\d+)|\d{3,}b)\/?["']/i);
        if (!hrefMatch) {
            hrefMatch = attrs.match(/href=["'](?:https?:\/\/[^\/]+)?\/(\d{3,}b)\/?["']/i);
        }
        if (hrefMatch) {
            var id = hrefMatch[1];
            if (id && id.endsWith('b')) id = id.replace('b', '');
            if (!id || seenLinks[id]) continue;
            seenLinks[id] = 1;

            var titleMatch = attrs.match(/title=["']([^"']+)["']/i);
            var epTitle = titleMatch ? titleMatch[1] : "";
            eps.push({ id: id, title: epTitle });
        }
    }

    if (eps.length === 0) return null;

    for (var i = 0; i < eps.length; i++) {
        var item = eps[i];
        var epMatch = item.title.match(/Epis[oó]dio\s*(\d+)/i) || item.title.match(/Ep\.?\s*(\d+)/i) || item.title.match(/\bE?(\d+)\b/i);
        var epNum = epMatch ? parseInt(epMatch[1], 10) : (i + 1);
        if (epNum === parseInt(targetEp, 10)) {
            epId = item.id;
            break;
        }
    }
    return epId;
}

function extractStream(html) {
    var finalUrl = null;
    var iframeRe = /<iframe[^>]+src=["']([^"']+)["']/gi;
    var match;
    var isIframe = false;
    var typeStr = "web";

    var iframes = [];
    while ((match = iframeRe.exec(html)) !== null) {
        iframes.push(match[1]);
    }

    for (var i = 0; i < iframes.length; i++) {
        var src = iframes[i];
        if (src.indexOf("facebook") !== -1 || src.indexOf("disqus") !== -1 || src.indexOf("ads") !== -1) continue;

        var dMatch = src.match(/[?&]d=([^&]+)/);
        if (dMatch) {
            var inner = dMatch[1];
            try { inner = decodeURIComponent(inner); } catch (e) {}
            if (/\.m3u8/i.test(inner)) return { url: inner, type: "hls", isIframe: false };
            if (/\.mp4/i.test(inner)) return { url: inner, type: "mp4", isIframe: false };
        }

        if (/\.m3u8/i.test(src)) return { url: src, type: "hls", isIframe: false };
        if (/\.mp4(\?|$)/i.test(src)) return { url: src, type: "mp4", isIframe: false };

        finalUrl = src;
        if (finalUrl.indexOf("http") !== 0) finalUrl = "https:" + finalUrl;
        isIframe = true;
        break; 
    }

    if (!finalUrl) {
       var mp4Match = html.match(/(https?:\/\/[^\s"'<>]+(?:\.m3u8|\.mp4)[^\s"'<>]*)/i);
       if (mp4Match) {
           finalUrl = mp4Match[1];
           typeStr = finalUrl.indexOf(".m3u8") !== -1 ? "hls" : "mp4";
           isIframe = false;
       } else {
           return null;
       }
    }

    return { url: finalUrl, type: typeStr, isIframe: isIframe };
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
function getStreams(tmdbId, type, season, episode) {
  return __async(this, null, function* () {
    try {
      if (!tmdbId) return [];
      var info = yield getTmdbInfo(tmdbId, type);
      if (!info || (!info.title && !info.originalTitle)) return [];
      
      console.log("[" + PROVIDER_TAG + " v" + PROVIDER_VERSION + "] " + type + " " + (info.title || info.originalTitle));

      var targetEp = episode || 1;
      
      var queries = buildQueries(info.originalTitle || info.title, info.altTitles);
      var allTitles = buildAllTitles(info.originalTitle || info.title, info.altTitles);
      
      var candidatePages = [];
      var seenPage = {};
      var hasCloudflare = false;

      var SIMILARITY_THRESHOLD = 0.45;

      for (var q = 0; q < queries.length && candidatePages.length < 4; q++) {
          var searchResults = yield searchAnime(queries[q]);
          if (searchResults.length > 0 && searchResults[0].cloudflare) {
             hasCloudflare = true;
             break;
          }
          for (var sr = 0; sr < searchResults.length; sr++) {
              var candidate = searchResults[sr];
              if (seenPage[candidate.id]) continue;
              
              var nameForScore = candidate.name.replace(/\s*[\(\[]?\s*(dublado|legendado|dub|leg)\s*[\)\]]?/gi, '').trim();
              
              var bestScore = 0;
              for(var t=0; t<allTitles.length; t++) {
                  var sc = similarity(allTitles[t], nameForScore);
                  if (sc > bestScore) bestScore = sc;
              }

              if (bestScore >= SIMILARITY_THRESHOLD) {
                  seenPage[candidate.id] = 1;
                  candidatePages.push({ page: candidate, score: bestScore });
                  if (candidatePages.length >= 6) break;
              }
          }
      }

      if (hasCloudflare) {
          return [{ url: BASE_URL, quality: "Erro", title: "❌ Anitube: Bloqueado pelo Cloudflare", type: "web" }];
      }

      if (candidatePages.length === 0) return [];
      console.log("[" + PROVIDER_TAG + "] " + candidatePages.length + " candidate pages");

      // Sort candidates by score descending
      candidatePages.sort(function(a, b) { return b.score - a.score; });

      var streams = [];
      var seenStreamUrl = {};

      for (var cp = 0; cp < candidatePages.length && streams.length < 4; cp++) {
          var page = candidatePages[cp].page;
          var score = candidatePages[cp].score;
          
          var pageRes = yield fetchText(page.url);
          if (pageRes.status !== 200) continue;

          var epId = parseEpisodeId(pageRes.text, targetEp);
          if (!epId) continue; 

          // Fetch episode page using the b/ suffix strategy (Stremio compatibility)
          var epUrl = BASE_URL + "/" + epId + "b/";
          var epRes = yield fetchText(epUrl);
          if (epRes.status !== 200) {
              // fallback
              epUrl = BASE_URL + "/video/" + epId + "/";
              epRes = yield fetchText(epUrl);
              if (epRes.status !== 200) continue;
          }

          var sx = extractStream(epRes.text);
          if (!sx) continue;

          if (seenStreamUrl[sx.url]) continue;
          seenStreamUrl[sx.url] = 1;

          var displayTitle = info.title || "Anime";
          var isDubbed = /dublado/i.test(page.name);
          var flag = isDubbed ? "DUB" : "LEG";

          console.log("[" + PROVIDER_TAG + "] OK score=" + score.toFixed(2) + " flag=" + flag);

          streams.push({
              name: 'Anitube (' + (isDubbed ? "DUB" : "LEG") + ') ' + (sx.quality || "Auto"),
              title: displayTitle + " · EP " + targetEp,
              quality: sx.quality || "Auto",
              url: sx.url,
              type: sx.type,
              behaviorHints: { notWebReady: true, bingeGroup: "anitube-" + page.id },
              headers: {
                  "User-Agent": USER_AGENT,
                  "Referer": BASE_URL + "/",
                  "Origin": BASE_URL,
                  "Accept": "*/*"
              },
              provider: "anitube"
          });
      }
      
      console.log("[" + PROVIDER_TAG + "] total streams: " + streams.length);
      return streams;

    } catch (error) {
      console.log("[" + PROVIDER_TAG + "] error: " + error);
      return [];
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else if (typeof global !== "undefined") {
  global.getStreams = getStreams;
}
