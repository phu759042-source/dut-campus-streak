// Vercel Function for public pages that need their own search/preview metadata (see vercel.json).
// Search engines and AI crawlers often read the HTML without running JavaScript, so the app page is
// returned with the title, description, canonical URL, preview tags and structured data of that page.
// Browsers get the same page and the app takes over as usual.
const SITE = 'https://www.campusstreak.com';

const PAGES = {
  map: {
    path: '/map',
    // "map dut" / "dut map" are the most searched words for this page (Search Console, Nov 2026): say them first
    title: 'Map DUT 3D – Bản đồ Trường Đại học Bách khoa Đà Nẵng | DUT Campus Streak',
    ogTitle: 'Map DUT 3D – Bản đồ khuôn viên Trường Đại học Bách khoa Đà Nẵng',
    description: 'Map DUT 3D: xem toàn bộ khuôn viên Bách khoa Đà Nẵng (54 Nguyễn Lương Bằng), tìm phòng F305 ở khu nào, đi dạo nhập vai, vào tận phòng học Khu H, Khu B. Miễn phí, không cần đăng nhập.',
    mapPage: true,
    image: `${SITE}/og-map.jpg`,
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': `${SITE}/map#page`,
          url: `${SITE}/map`,
          name: 'Map DUT 3D – Bản đồ DUT 3D',
          alternateName: ['Bản đồ DUT', 'DUT map', 'Bản đồ Bách khoa Đà Nẵng'],
          inLanguage: 'vi',
          description: 'Bản đồ 3D tương tác của khuôn viên Trường Đại học Bách khoa – Đại học Đà Nẵng, có tìm phòng học và chế độ đi dạo nhập vai.',
          isPartOf: { '@type': 'WebSite', name: 'DUT Campus Streak', url: `${SITE}/` },
          about: { '@id': `${SITE}/map#campus` },
          primaryImageOfPage: `${SITE}/og-map.jpg`,
        },
        {
          '@type': 'CollegeOrUniversity',
          '@id': `${SITE}/map#campus`,
          name: 'Trường Đại học Bách khoa – Đại học Đà Nẵng',
          alternateName: ['DUT', 'Bách khoa Đà Nẵng', 'The University of Danang – University of Science and Technology'],
          address: {
            '@type': 'PostalAddress',
            streetAddress: '54 Nguyễn Lương Bằng',
            addressLocality: 'Liên Chiểu, Đà Nẵng',
            addressCountry: 'VN',
          },
          geo: { '@type': 'GeoCoordinates', latitude: 16.0745, longitude: 108.152 },
          hasMap: `${SITE}/map`,
        },
      ],
    },
  },
  // About + FAQ page; its text comes from /data/faq.json (the same file the app page shows)
  intro: {
    path: '/gioi-thieu',
    faq: true,
    title: 'Giới thiệu DUT Campus Streak – App check-in lớp học sinh viên Bách khoa Đà Nẵng',
    ogTitle: 'Giới thiệu DUT Campus Streak & câu hỏi thường gặp',
    description: 'DUT Campus Streak là gì? App miễn phí cho sinh viên Bách khoa Đà Nẵng: check-in lớp bằng ảnh biển phòng, streak, bảng xếp hạng, thời khóa biểu, deadline, bản đồ 3D, server online, đá bóng và sự kiện Đồ thất lạc.',
    image: `${SITE}/og-image.jpg`,
  },
};

// /map: what the map shows, in words, for crawlers (the 3D scene itself has no text) and a few questions as FAQPage
const MAP_ZONES = [
  ['Khu A', 'khu hiệu bộ (nhà hành chính) chữ H, có hai hồ cá trong sân và tượng trên bãi cỏ phía trước'],
  ['Khu B', 'dãy nhà học 4 tầng với tháp sảnh gạch hoa, mái sảnh bê tông; vào được hành lang và các phòng B101–B407'],
  ['Khu C, D, E1, E2, G, I, K, M, N, P, X', 'các dãy nhà học, xưởng và viện; căn tin nằm cạnh Khu E1, đi vào bên trong được'],
  ['Khu F', 'dãy nhà học 4 tầng, Hội trường F, tháp có khối logo trường và sân F lát đá'],
  ['Khu H', 'khối nhà học hình chữ V, vào được cả 4 tầng theo sơ đồ phòng thật (H101–H402)'],
  ['Khu L – Trung tâm Học liệu', 'thư viện, Trung tâm Học liệu và Truyền thông'],
  ['Nhà S', 'tòa nhà cao nhất trường (10 tầng, khoảng 42 m) có logo và tên trường'],
  ['Sân vận động, ký túc xá, đài phun nước', 'đường chạy 400 m và khán đài, các nhà ký túc xá, hồ và đài phun nước cạnh Khu F'],
  ['Cổng trường', 'cổng chính đường Nguyễn Lương Bằng và cổng phụ đường Ngô Sĩ Liên (cầu vượt đường sắt)'],
];
const MAP_FAQ = [
  ['Map DUT 3D là gì?', 'Là bản đồ 3D khuôn viên Trường Đại học Bách khoa – Đại học Đà Nẵng tại 54 Nguyễn Lương Bằng, Liên Chiểu, Đà Nẵng. Mở trên trình duyệt, miễn phí, không cần đăng nhập.'],
  ['Phòng F305 nằm ở đâu?', 'Chữ cái đầu là khu, chữ số đầu là tầng: F305 nằm ở Khu F, tầng 3. Gõ mã phòng vào ô tìm kiếm của Map DUT 3D để bản đồ bay tới đúng khu đó.'],
  ['Có đi vào bên trong các tòa nhà được không?', 'Có. Ở chế độ đi dạo nhập vai, bạn vào được căn tin, hành lang Khu E1, cả 4 tầng Khu H và Khu B với các phòng học.'],
  ['Map DUT có dùng được trên điện thoại không?', 'Có, trên điện thoại có joystick để đi dạo; trên máy tính dùng phím WASD. Có chế độ ngày/đêm và nhạc nền.'],
];
function mapExtras(page) {
  const url = SITE + page.path;
  const jsonld = { ...page.jsonld, '@graph': [...page.jsonld['@graph'], {
    '@type': 'FAQPage', '@id': `${url}#faq`, url, inLanguage: 'vi',
    mainEntity: MAP_FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }] };
  const body = `<h1>${esc(page.ogTitle)}</h1><p>${esc(page.description)}</p>` +
    `<h2>Các khu trong Map DUT 3D</h2><ul>${MAP_ZONES.map(([t, x]) => `<li><b>${esc(t)}</b>: ${esc(x)}</li>`).join('')}</ul>` +
    `<h2>Câu hỏi thường gặp về Map DUT</h2>${MAP_FAQ.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}` +
    `<p><a href="/">DUT Campus Streak</a> – ứng dụng check-in lớp học, streak, thời khóa biểu và deadline cho sinh viên Bách khoa Đà Nẵng · <a href="/gioi-thieu">Giới thiệu</a></p>`;
  return { jsonld, body };
}

// FAQPage + AboutPage structured data and a plain-HTML copy of the page for crawlers
function introExtras(d, page) {
  const url = SITE + page.path;
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['AboutPage', 'FAQPage'],
        '@id': `${url}#page`,
        url,
        name: page.ogTitle,
        inLanguage: 'vi',
        description: d.intro,
        isPartOf: { '@type': 'WebSite', name: 'DUT Campus Streak', url: `${SITE}/` },
        mainEntity: d.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
      {
        '@type': 'WebApplication',
        name: 'DUT Campus Streak',
        url: `${SITE}/`,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web, Android, iOS, Windows, macOS',
        inLanguage: 'vi',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'VND' },
        featureList: d.features.map(([t]) => t),
      },
    ],
  };
  const body = `<h1>Giới thiệu DUT Campus Streak</h1><p>${esc(d.intro)}</p>` +
    `<h2>Tính năng chính</h2>${d.features.map(([t, x]) => `<h3>${esc(t)}</h3><p>${esc(x)}</p>`).join('')}` +
    `<h2>Câu hỏi thường gặp</h2>${d.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}` +
    `<p><a href="/register">Đăng ký</a> · <a href="/login">Đăng nhập</a> · <a href="/map">Map DUT 3D – bản đồ trường</a></p>`;
  return { jsonld, body };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

module.exports = async (req, res) => {
  const key = String((req.query && req.query.p) || '');
  const page = PAGES[key];
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'www.campusstreak.com';
  let html;
  try {
    const r = await fetch(`https://${host}/index.html`);
    html = await r.text();
  } catch {
    res.statusCode = 302; res.setHeader('Location', '/'); res.end(); return;
  }
  if (page) {
    const url = SITE + page.path;
    let jsonld = page.jsonld;
    let noscript = `<h1>${esc(page.ogTitle)}</h1><p>${esc(page.description)}</p><p><a href="/">DUT Campus Streak</a> – ứng dụng check-in lớp học, streak, thời khóa biểu và deadline cho sinh viên Bách khoa Đà Nẵng.</p>`;
    if (page.mapPage) { const x = mapExtras(page); jsonld = x.jsonld; noscript = x.body; }
    if (page.faq) {
      try {
        const d = await (await fetch(`https://${host}/data/faq.json`)).json();
        const x = introExtras(d, page);
        jsonld = x.jsonld; noscript = x.body;
      } catch { /* keep the short version */ }
    }
    const set = (re, val) => { html = html.replace(re, () => val); };
    set(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`);
    set(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(page.description)}" />`);
    set(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`);
    set(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`);
    set(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(page.ogTitle)}" />`);
    set(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(page.description)}" />`);
    set(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${page.image}" />`);
    set(/<meta property="og:image:secure_url" content="[^"]*" \/>/, `<meta property="og:image:secure_url" content="${page.image}" />`);
    set(/<meta property="og:image:alt" content="[^"]*" \/>/, `<meta property="og:image:alt" content="${esc(page.ogTitle)}" />`);
    set(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(page.ogTitle)}" />`);
    set(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(page.description)}" />`);
    set(/<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${page.image}" />`);
    // the site-wide structured data is replaced by this page's
    set(/<script type="application\/ld\+json" id="ld-site">[\s\S]*?<\/script>/, `<script type="application/ld+json" id="ld-site">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>`);
    // a short text version for crawlers that do not run JavaScript (hidden once the app starts)
    set(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>${noscript}</noscript>`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, max-age=0, must-revalidate');
  res.end(html);
};
