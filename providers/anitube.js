/**
 * Anitube - Nuvio Provider (Port of Stremio Addon Logic)
 * v4.2.0 — Correções:
 *  - extractStream: suporte a JWPlayer HLS (mecanismo atual do AniTube)
 *  - parseEpisodeId: container robusto (depth-count), regex preciso "– Episódio NNN"
 *  - getStreams: filtro de candidatos por season antes de fazer requests HTTP
 */
"use strict";

var TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
var BASE_URL = "https://www.anitube.zip";
var PROVIDER_TAG = "Anitube";
var PROVIDER_VERSION = "4.2.0";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36";

var __async = function (__this, __arguments, generator) {
  return new Promise(function (resolve, reject) {
    var fulfilled = function (v) { try { step(generator.next(v)); } catch (e) { reject(e); } };
    var rejected  = function (v) { try { step(generator.throw(v)); } catch (e) { reject(e); } };
    var step      = function (x) { return x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected); };
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
      var fetchOpts = {
        method: opts.method || "GET",
        redirect: "follow",
        headers: Object.assign({
          "User-Agent": USER_AGENT,
          Accept: "application/json, */*",
          "Accept-Language": "pt-BR,pt;q=0.9"
        }, opts.headers || {})
      };
      if (opts.body) fetchOpts.body = opts.body;
      var r = yield fetch(url, fetchOpts);
      var t = yield r.text();
      try { return { status: r.status, data: JSON.parse(t) }; }
      catch (e) { return { status: r.status, data: null, raw: t }; }
    } catch (e) { return { status: -1, data: null }; }
  });
}

// ─────────────────────────────────────────────
// Similarity & String utilities
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
  for (var i = 0; i < words.length - 1; i++) out.push(words[i] + ' ' + words[i + 1]);
  return out;
}

function similarity(a, b) {
  var na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1)
    return Math.min(na.length, nb.length) / Math.max(na.length, nb.length);

  var arrA = na.split(' ').filter(Boolean), arrB = nb.split(' ').filter(Boolean);
  var setB = {}, wordInter = 0, setA = {}, sizeA = 0, sizeB = 0;
  for (var i = 0; i < arrB.length; i++) setB[arrB[i]] = 1;
  for (var j = 0; j < arrA.length; j++) {
    if (!setA[arrA[j]]) { setA[arrA[j]] = 1; sizeA++; if (setB[arrA[j]]) wordInter++; }
  }
  for (var k in setB) sizeB++;
  var jaccard = wordInter / (sizeA + sizeB - wordInter);

  var bgAArr = bigrams(na), bgBArr = bigrams(nb), bgBSet = {}, bgBSize = 0;
  for (var m = 0; m < bgBArr.length; m++) { if (!bgBSet[bgBArr[m]]) { bgBSet[bgBArr[m]] = 1; bgBSize++; } }
  var bgInter = 0, bgASet = {}, bgASize = 0;
  for (var n = 0; n < bgAArr.length; n++) {
    if (!bgASet[bgAArr[n]]) { bgASet[bgAArr[n]] = 1; bgASize++; if (bgBSet[bgAArr[n]]) bgInter++; }
  }
  var dice = (bgASize + bgBSize) > 0 ? (2 * bgInter) / (bgASize + bgBSize) : 0;
  return Math.max(jaccard, dice);
}


function buildQueries(title, aliases) {
  var seen = {}, jpFirst = [], enLast = [];
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
  addTo(enLast, title.replace(/\s*\(Dub\)/i, '').split(':')[0].split(' - ')[0].trim());
  addTo(enLast, title.replace(/\s*\(Dub\)/i, '').trim());
  addTo(enLast, title);
  return jpFirst.concat(enLast);
}

function buildAllTitles(title, aliases) {
  var titles = {}, out = [];
  function add(s) {
    if (s && s.length > 1) { var n = normalize(s); if (n && !titles[n]) { titles[n] = 1; out.push(n); } }
  }
  add(title);
  add(title.replace(/\s*\(Dub\)/i, '').trim());
  add(title.split(':')[0].trim());
  if (aliases && aliases.length > 0) {
    for (var i = 0; i < aliases.length; i++) {
      if (typeof aliases[i] === 'string') { add(aliases[i]); add(aliases[i].split(':')[0].trim()); }
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// Season compatibility filter
// Retorna true se o nome do candidato é compatível com a season pedida.
// No AniTube cada temporada é uma série separada — a season está embutida no nome.
// ─────────────────────────────────────────────
function candidateMatchesSeason(candidateName, season) {
  var name = normalize(candidateName || '');
  if (!season || season <= 1) {
    // Season 1: rejeita nomes que indicam temporada 2+
    return !/\b(season|temporada|part|cour)\s*[2-9]\b/.test(name)
        && !/\b[2-9](?:nd|rd|th)?\s*season\b/.test(name);
  }
  // Season 2+: aceita nomes que mencionam explicitamente o número correto
  var s = String(season);
  return new RegExp('\\bseason\\s*' + s + '\\b').test(name)
      || new RegExp('\\btemporada\\s*' + s + '\\b').test(name)
      || new RegExp('\\bpart\\s*' + s + '\\b').test(name)
      || new RegExp('\\bcour\\s*' + s + '\\b').test(name)
      || new RegExp('[\\s\\-–]' + s + '(?:\\s|$)').test(name);
}


// ─────────────────────────────────────────────
// METADATA FETCHERS (TMDB, Kitsu, MAL, AniList)
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
    var isJapaneseOrigin = d.original_language === "ja" || origin.indexOf("JP") !== -1;
    var altTitles = [];
    var altRes = yield fetchJson(base + "/alternative_titles?api_key=" + TMDB_API_KEY);
    if (altRes && altRes.data) {
      var altList = altRes.data.results || altRes.data.titles || [];
      for (var i = 0; i < altList.length; i++) {
        var r = altList[i];
        if (!r || !r.title) continue;
        var c = (r.iso_3166_1 || "").toUpperCase();
        if (c === "JP" || c === "US" || c === "GB" || c === "BR" || c === "PT") altTitles.push(r.title);
      }
    }
    return { title: d.title || d.name || "", originalTitle: d.original_title || d.original_name || "",
             altTitles: altTitles, year: ((d.release_date || d.first_air_date || "").split("-")[0]) || null,
             isAnime: isJapaneseOrigin };
  });
}

function getKitsuInfo(id) {
  return __async(this, null, function* () {
    var res = yield fetchJson("https://kitsu.io/api/edge/anime/" + id);
    if (!res.data || !res.data.data || !res.data.data.attributes) return null;
    var attr = res.data.data.attributes;
    var altTitles = [];
    if (attr.titles) {
      if (attr.titles.en) altTitles.push(attr.titles.en);
      if (attr.titles.en_jp) altTitles.push(attr.titles.en_jp);
      if (attr.titles.ja_jp) altTitles.push(attr.titles.ja_jp);
    }
    if (attr.abbreviatedTitles) altTitles = altTitles.concat(attr.abbreviatedTitles);
    return { title: attr.titles.en_jp || attr.titles.en || attr.canonicalTitle,
             originalTitle: attr.titles.ja_jp || attr.canonicalTitle, altTitles: altTitles,
             year: (attr.startDate || "").split("-")[0] || null, isAnime: true };
  });
}

function getMalInfo(id) {
  return __async(this, null, function* () {
    var res = yield fetchJson("https://api.jikan.moe/v4/anime/" + id);
    if (!res.data || !res.data.data) return null;
    var attr = res.data.data;
    var altTitles = attr.title_synonyms || [];
    if (attr.title_english) altTitles.push(attr.title_english);
    if (attr.title_japanese) altTitles.push(attr.title_japanese);
    return { title: attr.title || attr.title_english, originalTitle: attr.title_japanese || attr.title,
             altTitles: altTitles, year: attr.year || (attr.aired && attr.aired.from ? attr.aired.from.split("-")[0] : null),
             isAnime: true };
  });
}

function getAnilistInfo(id) {
  return __async(this, null, function* () {
    var query = 'query($id:Int){Media(id:$id,type:ANIME){title{romaji english native} synonyms startDate{year}}}';
    var res = yield fetchJson("https://graphql.anilist.co", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: { id: parseInt(id) } })
    });
    if (!res.data || !res.data.data || !res.data.data.Media) return null;
    var media = res.data.data.Media;
    var altTitles = media.synonyms || [];
    if (media.title.english) altTitles.push(media.title.english);
    if (media.title.native) altTitles.push(media.title.native);
    return { title: media.title.romaji || media.title.english, originalTitle: media.title.native || media.title.romaji,
             altTitles: altTitles, year: media.startDate ? media.startDate.year : null, isAnime: true };
  });
}


// ─────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────
function searchAnime(query) {
  return __async(this, null, function* () {
    if (!query) return [];
    var url = BASE_URL + "/?s=" + encodeURIComponent(query);
    var res = yield fetchText(url);
    if (res.status === 403 || res.status === 503) return [{ cloudflare: true }];
    if (res.status !== 200 || !res.text) return [];

    var results = [], seen = {}, aTagRe = /<a\s+([^>]+)>/gi, m;
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

// ─────────────────────────────────────────────
// parseEpisodeId — CORRIGIDO
// Container extraído com depth-count (evita truncamento por </div> interno).
// Regex de episódio prioriza "– Episódio NNN" (padrão real do AniTube).
// ─────────────────────────────────────────────
function parseEpisodeId(html, targetEp) {
  var epId = null;
  var eps  = [];

  // Extrai o conteúdo de .pagAniListaContainer contando profundidade de tags
  var targetHtml = html;
  var containerIdx = html.indexOf('pagAniListaContainer');
  if (containerIdx !== -1) {
    var openEnd = html.indexOf('>', containerIdx);
    if (openEnd !== -1) {
      var depth = 1, pos = openEnd + 1;
      while (pos < html.length && depth > 0) {
        var nextOpen  = html.indexOf('<div', pos);
        var nextClose = html.indexOf('</div', pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) { depth++; pos = nextOpen + 4; }
        else { depth--; pos = nextClose + 5; }
      }
      targetHtml = html.substring(openEnd + 1, pos);
    }
  }

  var aTagRe = /<a\s+([^>]+)>/gi, m, seenLinks = {};
  while ((m = aTagRe.exec(targetHtml)) !== null) {
    var attrs     = m[1];
    // Só captura /video/NNN/ — formato confirmado na lista de episódios do AniTube
    var hrefMatch = attrs.match(/href=["'](?:https?:\/\/[^\/]+)?\/video\/(\d+)\/?["']/i);
    if (!hrefMatch) continue;
    var id = hrefMatch[1];
    if (!id || seenLinks[id]) continue;
    seenLinks[id] = 1;
    var titleMatch = attrs.match(/title=["']([^"']+)["']/i);
    eps.push({ id: id, title: titleMatch ? titleMatch[1] : "" });
  }

  if (eps.length === 0) return null;

  for (var i = 0; i < eps.length; i++) {
    var item = eps[i];
    // Prioridade máxima: "– Episódio NNN" (padrão zero-padded real do AniTube)
    var epMatch = item.title.match(/[–\-]\s*Epis[oó]dio\s+(\d+)/i)
               || item.title.match(/\bEpis[oó]dio\s+(\d+)/i)
               || item.title.match(/\bEp\.?\s*(\d+)/i)
               || item.title.match(/\bE(\d{2,})\b/i);
    var epNum = epMatch ? parseInt(epMatch[1], 10) : (i + 1);
    if (epNum === parseInt(targetEp, 10)) { epId = item.id; break; }
  }
  return epId;
}


// ─────────────────────────────────────────────
// extractStream — CORRIGIDO
// Suporta JWPlayer HLS (mecanismo atual do AniTube) antes do fallback de iframe.
// ─────────────────────────────────────────────
function extractStream(html) {
  // 1. JWPlayer HLS — mecanismo atual confirmado pela análise HTML do AniTube
  //    Formato: jwplayer('playerV').setup({ playlist: [{ sources: [{ file: 'https://...index.m3u8' }] }] })
  var jwMatch = html.match(
    /jwplayer\s*\([^)]+\)\s*\.setup\s*\(\s*\{[\s\S]*?file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i
  );
  if (jwMatch && jwMatch[1]) return { url: jwMatch[1], type: "hls", isIframe: false };

  // 2. Fonte .m3u8 em tag <source> ou variáveis JS (players alternativos)
  var srcMatch = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i)
              || html.match(/['"]([^'"]+\.m3u8[^'"]*)['"]/);
  if (srcMatch && srcMatch[1] && srcMatch[1].indexOf('http') === 0)
    return { url: srcMatch[1], type: "hls", isIframe: false };

  // 3. iframe legado (episódios mais antigos / players externos)
  var iframes = [], iframeRe = /<iframe[^>]+src=["']([^"']+)["']/gi, match;
  while ((match = iframeRe.exec(html)) !== null) iframes.push(match[1]);

  for (var i = 0; i < iframes.length; i++) {
    var src = iframes[i];
    if (src.indexOf("facebook") !== -1 || src.indexOf("disqus") !== -1 || src.indexOf("ads") !== -1) continue;

    var dMatch = src.match(/[?&]d=([^&]+)/);
    if (dMatch) {
      var inner = dMatch[1];
      try { inner = decodeURIComponent(inner); } catch (e) {}
      if (/\.m3u8/i.test(inner)) return { url: inner, type: "hls",  isIframe: false };
      if (/\.mp4/i.test(inner))  return { url: inner, type: "mp4",  isIframe: false };
    }
    if (/\.m3u8/i.test(src))         return { url: src, type: "hls", isIframe: false };
    if (/\.mp4(\?|$)/i.test(src))    return { url: src, type: "mp4", isIframe: false };

    var finalUrl = src.indexOf("http") !== 0 ? "https:" + src : src;
    return { url: finalUrl, type: "web", isIframe: true };
  }

  // 4. URL direta MP4 no HTML
  var mp4Match = html.match(/(https?:\/\/[^\s"'<>]+(?:\.m3u8|\.mp4)[^\s"'<>]*)/i);
  if (mp4Match) return { url: mp4Match[1], type: mp4Match[1].indexOf(".m3u8") !== -1 ? "hls" : "mp4", isIframe: false };

  return null;
}


// ─────────────────────────────────────────────
// Main — getStreams
// CORRIGIDO: candidatos filtrados por season antes de requests HTTP
// ─────────────────────────────────────────────
function getStreams(tmdbId, type, season, episode) {
  return __async(this, null, function* () {
    try {
      if (!tmdbId) return [];

      var info = null;
      var idString = String(tmdbId);

      if      (idString.indexOf("kitsu:") === 0) info = yield getKitsuInfo(idString.split(":")[1]);
      else if (idString.indexOf("mal:")   === 0) info = yield getMalInfo(idString.split(":")[1]);
      else if (idString.indexOf("al:")    === 0) info = yield getAnilistInfo(idString.split(":")[1]);
      else                                       info = yield getTmdbInfo(tmdbId, type);

      if (!info || (!info.title && !info.originalTitle)) return [];

      console.log("[" + PROVIDER_TAG + " v" + PROVIDER_VERSION + "] " + type + " " + (info.title || info.originalTitle)
                  + " s" + (season || 1) + "e" + (episode || 1));

      var targetEp = episode || 1;
      var targetSeason = season || 1;

      var queries    = buildQueries(info.originalTitle || info.title, info.altTitles);
      var allTitles  = buildAllTitles(info.originalTitle || info.title, info.altTitles);

      // Coleta candidatos de todas as queries, sem repetição
      var candidatePages = [], seenPage = {}, hasCloudflare = false;
      var SIMILARITY_THRESHOLD = 0.45;

      for (var q = 0; q < queries.length && candidatePages.length < 6; q++) {
        var searchResults = yield searchAnime(queries[q]);
        if (searchResults.length > 0 && searchResults[0].cloudflare) { hasCloudflare = true; break; }
        for (var sr = 0; sr < searchResults.length; sr++) {
          var candidate = searchResults[sr];
          if (seenPage[candidate.id]) continue;

          // ── NOVO: filtra por season antes de calcular score ──
          // Evita selecionar "Bleach Season 1" quando season=2 foi pedida
          if (type === 'series' && !candidateMatchesSeason(candidate.name, targetSeason)) continue;

          var nameForScore = candidate.name.replace(/\s*[\(\[]?\s*(dublado|legendado|dub|leg)\s*[\)\]]?/gi, '').trim();
          var bestScore = 0;
          for (var t = 0; t < allTitles.length; t++) {
            var sc = similarity(allTitles[t], nameForScore);
            if (sc > bestScore) bestScore = sc;
          }
          if (bestScore >= SIMILARITY_THRESHOLD) {
            seenPage[candidate.id] = 1;
            candidatePages.push({ page: candidate, score: bestScore });
          }
        }
      }

      if (hasCloudflare)
        return [{ url: BASE_URL, quality: "Erro", title: "❌ Anitube: Bloqueado pelo Cloudflare", type: "web" }];

      // Fallback: se season filter eliminou tudo, tenta sem filtro de season
      if (candidatePages.length === 0 && targetSeason > 1) {
        console.log("[" + PROVIDER_TAG + "] Season filter retornou zero — retentando sem filtro de season");
        seenPage = {};
        for (var q2 = 0; q2 < queries.length && candidatePages.length < 6; q2++) {
          var sr2 = yield searchAnime(queries[q2]);
          if (sr2.length > 0 && sr2[0].cloudflare) break;
          for (var i2 = 0; i2 < sr2.length; i2++) {
            var c2 = sr2[i2];
            if (seenPage[c2.id]) continue;
            var nfs2 = c2.name.replace(/\s*[\(\[]?\s*(dublado|legendado|dub|leg)\s*[\)\]]?/gi, '').trim();
            var sc2 = allTitles.reduce(function(mx, tt) { return Math.max(mx, similarity(tt, nfs2)); }, 0);
            if (sc2 >= SIMILARITY_THRESHOLD) { seenPage[c2.id] = 1; candidatePages.push({ page: c2, score: sc2 }); }
          }
        }
      }

      if (candidatePages.length === 0) return [];
      console.log("[" + PROVIDER_TAG + "] " + candidatePages.length + " candidatos encontrados");
      candidatePages.sort(function(a, b) { return b.score - a.score; });

      var streams = [], seenStreamUrl = {};

      for (var cp = 0; cp < candidatePages.length && streams.length < 4; cp++) {
        var page  = candidatePages[cp].page;
        var score = candidatePages[cp].score;

        // Página da série: /video/{seriesId}/
        var pageRes = yield fetchText(page.url);
        if (pageRes.status !== 200) continue;

        var epId = parseEpisodeId(pageRes.text, targetEp);
        if (!epId) continue;

        // Página do episódio: /video/{epId}/
        var epUrl = BASE_URL + "/video/" + epId + "/";
        var epRes = yield fetchText(epUrl);
        if (epRes.status !== 200) {
          // fallback para alias /{epId}b/
          epUrl = BASE_URL + "/" + epId + "b/";
          epRes = yield fetchText(epUrl);
          if (epRes.status !== 200) continue;
        }

        var sx = extractStream(epRes.text);
        if (!sx) continue;
        if (seenStreamUrl[sx.url]) continue;
        seenStreamUrl[sx.url] = 1;

        var isDubbed = /dublado/i.test(page.name);
        var flag     = isDubbed ? "DUB" : "LEG";
        console.log("[" + PROVIDER_TAG + "] OK score=" + score.toFixed(2) + " flag=" + flag + " type=" + sx.type);

        streams.push({
          name    : "Anitube (" + flag + ") " + (sx.quality || sx.type || "Auto"),
          title   : (info.title || "Anime") + " · S" + targetSeason + "E" + targetEp,
          quality : sx.quality || (sx.type === "hls" ? "HLS" : "Auto"),
          url     : sx.url,
          type    : sx.type,
          behaviorHints: { notWebReady: true, bingeGroup: "anitube-" + page.id },
          headers : { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/", "Origin": BASE_URL, "Accept": "*/*" },
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
