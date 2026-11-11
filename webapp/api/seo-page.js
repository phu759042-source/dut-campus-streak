// Vercel Function for public pages that need their own search/preview metadata (see vercel.json).
// Search engines and AI crawlers often read the HTML without running JavaScript, so the app page is
// returned with the title, description, canonical URL, preview tags and structured data of that page.
// Browsers get the same page and the app takes over as usual.
const SITE = 'https://www.campusstreak.com';

const PAGES = {
  map: {
    path: '/map',
    title: 'Bản đồ DUT 3D – Khám phá Trường Đại học Bách khoa Đà Nẵng | Campus Streak',
    ogTitle: 'Bản đồ DUT 3D – Khuôn viên Trường Đại học Bách khoa Đà Nẵng',
    description: 'Bản đồ 3D khuôn viên Trường Đại học Bách khoa – ĐHĐN (54 Nguyễn Lương Bằng): tìm khu A, B, C, D, E, F, H, L (Trung tâm Học liệu), Nhà S, căn tin, ký túc xá, sân vận động; tìm phòng như F305 và đi dạo nhập vai quanh trường. Dành cho tân sinh viên, không cần đăng nhập.',
    image: `${SITE}/og-map.jpg`,
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': `${SITE}/map#page`,
          url: `${SITE}/map`,
          name: 'Bản đồ DUT 3D',
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
};

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
    const set = (re, val) => { html = html.replace(re, val); };
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
    set(/<script type="application\/ld\+json" id="ld-site">[\s\S]*?<\/script>/, `<script type="application/ld+json" id="ld-site">${JSON.stringify(page.jsonld)}</script>`);
    // a short text version for crawlers that do not run JavaScript (hidden once the app starts)
    set(/<noscript>[\s\S]*?<\/noscript>/, `<noscript><h1>${esc(page.ogTitle)}</h1><p>${esc(page.description)}</p><p><a href="/">DUT Campus Streak</a> – ứng dụng check-in lớp học, streak, thời khóa biểu và deadline cho sinh viên Bách khoa Đà Nẵng.</p></noscript>`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, max-age=0, must-revalidate');
  res.end(html);
};
