import * as cheerio from 'cheerio';

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
        items.push({ section, title, link, description });
      }
    });
  });

  return items;
}

export default async function handler(req, res) {
  const SOURCE_URL = 'https://lpu.cz/beda/';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let html;

  try {
    const res = await fetch(SOURCE_URL, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    html = await res.text();
  } catch (err) {
    res.status(502).send('Failed to fetch source: ' + err.message);
    return;
  }

  const $ = cheerio.load(html, { decodeEntities: false });

  const novinky = parseNovinky($);
  const main = parseMainSections($);
  const allItems = [...novinky, ...main];

  let itemXml = '';
  allItems.forEach((item) => {
    const description = item.description || item.title;
    const pubDate = toRfc822(item.date, item.time);

    itemXml += `    <item>\n`;
    itemXml += `      <description><![CDATA[[${escapeXml(item.section)}] ${description}]]></description>\n`;
    if (pubDate) {
      itemXml += `      <pubDate>${pubDate}</pubDate>\n`;
    }
    itemXml += `    </item>\n`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Jak to vidí Béďa</title>
    <link>${SOURCE_URL}</link>
    <description>pár zpráv a názorů z Pardubic</description>
    <language>cs</language>
    <docs>https://validator.w3.org/feed/docs/rss2.html</docs>
    <ttl>1440</ttl>
    ${itemXml}
  </channel>
</rss>`;

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(xml);
}
