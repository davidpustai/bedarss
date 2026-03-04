import * as cheerio from 'cheerio';

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parsePageTimestamp($) {
  const raw = $('div.akt').first().text().trim();
  // e.g. "út 03. 03. 08:41"
  const parts = raw.split(/\s+/);
  const year = new Date().getFullYear();
  let date = '';
  let time = '';
  if (parts.length >= 4) {
    const day = parts[1].replace('.', '').padStart(2, '0');
    const month = parts[2].replace('.', '').padStart(2, '0');
    date = `${day}.${month}.${year}`;
    time = parts[3] || '';
  }
  return { date, time };
}

function toRfc822(date, time) {
  // date: "DD.MM.YYYY", time: "HH:MM"
  if (!date) return '';
  const [dd, mm, yyyy] = date.split('.');
  const [hh, min] = time ? time.split(':') : ['00', '00'];
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min)));
  if (isNaN(d)) return '';
  return d.toUTCString();
}

function parseNovinky($) {
  const items = [];
  let currentDate = '';

  $('td[width="130"] table tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length === 0) return;

    // Date row: single td with bgcolor=lightgreen
    const firstTd = tds.first();
    const bg = (firstTd.attr('bgcolor') || '').toLowerCase();
    if (bg === 'lightgreen') {
      const raw = firstTd.text().trim();
      // format: "DD.MM.YYYY" or similar
      const match = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (match) {
        currentDate = `${match[1].padStart(2, '0')}.${match[2].padStart(2, '0')}.${match[3]}`;
      }
      return;
    }

    // Content row
    tds.each((_, td) => {
      const tdEl = $(td);
      const text = tdEl.text().trim();
      if (!text) return;

      // Optional time prefix "HH:MM"
      let time = '';
      const timeMatch = text.match(/^(\d{2}:\d{2})\s+/);
      if (timeMatch) time = timeMatch[1];

      const a = tdEl.find('a').first();
      let title = '';
      let link = '';

      if (a.length) {
        title = a.text().trim();
        link = a.attr('href') || '';
        if (link && !link.startsWith('http')) {
          link = 'https://lpu.cz' + (link.startsWith('/') ? '' : '/') + link;
        }
      } else {
        title = text.replace(/^\d{2}:\d{2}\s+/, '');
      }

      if (title) {
        items.push({ section: 'NOVINKY ČSOS', title, link, date: currentDate, time });
      }
    });
  });

  return items;
}

function parseMainSections($) {
  const items = [];
  const { date, time } = parsePageTimestamp($);

  $('div.nadpis').each((_, el) => {
    const section = $(el).text().trim();
    // Walk forward siblings to find the next <ul>
    let sibling = $(el).next();
    while (sibling.length && sibling.prop('tagName') !== 'UL') {
      sibling = sibling.next();
    }
    if (!sibling.length) return;

    sibling.find('> li').each((_, li) => {
      const liEl = $(li);
      let title = liEl.find('b').first().text().trim();
      if (!title) {
        title = liEl.text().replace(/NEW!/gi, '').trim();
      }

      const a = liEl.find('a[href]').first();
      let link = a.attr('href') || '';
      if (link && !link.startsWith('http')) {
        link = 'https://lpu.cz' + (link.startsWith('/') ? '' : '/') + link;
      }

      const description = liEl.text().trim();

      if (title) {
        items.push({ section, title, link, date, time, description });
      }
    });
  });

  return items;
}

export default async function handler(req, res) {
  const sourceUrl = 'https://lpu.cz/beda/';
  let html;

  try {
    const response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'bedarss/1.0' },
    });
    html = await response.text();
  } catch (err) {
    res.status(502).send('Failed to fetch source: ' + err.message);
    return;
  }

  const $ = cheerio.load(html, { decodeEntities: false });
  const { date: pageDate, time: pageTime } = parsePageTimestamp($);

  const novinky = parseNovinky($);
  const main = parseMainSections($);
  const allItems = [...novinky, ...main];

  let itemXml = '';
  allItems.forEach((item, i) => {
    const link = item.link || `https://lpu.cz/beda/#item-${i}`;
    const guid = link;
    const description = item.description || item.title;
    const pubDate = toRfc822(item.date, item.time);

    itemXml += `    <item>\n`;
    itemXml += `      <description><![CDATA[[${escapeXml(item.section)}] ${description}]]></description>\n`;
    itemXml += `      <guid isPermaLink="false">${escapeXml(guid)}</guid>\n`;
    if (pubDate) {
      itemXml += `      <pubDate>${pubDate}</pubDate>\n`;
    }
    itemXml += `    </item>\n`;
  });

  const lastBuild = toRfc822(pageDate, pageTime);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>beda.lpu.cz</title>
    <link>${sourceUrl}</link>
    <description>Orienteering news aggregator — lpu.cz/beda/</description>
    <language>cs</language>${lastBuild ? `\n    <lastBuildDate>${lastBuild}</lastBuildDate>` : ''}
${itemXml}  </channel>
</rss>`;

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(xml);
}
