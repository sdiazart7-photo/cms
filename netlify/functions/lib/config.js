// Configuración central del panel. Todo lo que cambia de un sitio a otro vive acá.

const [owner, repo] = String(process.env.SITE_REPO || 'sdiazart7-photo/finite-estudio-web').split('/');

module.exports = {
  owner,
  repo,
  branch: process.env.SITE_BRANCH || 'main',

  // Dominio con el que el sitio publica sus canonicals y su sitemap.
  origin: 'https://finiteestudio.com',
  siteName: 'Finite Estudio',
  authorName: 'Finite Estudio',

  cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'drrhn6t1c',

  blogIndexPath: 'blog/index.html',
  sitemapPath: 'sitemap.xml',
  redirectsPath: '_redirects',
  homePath: 'index.html',
  postPath: (slug) => `blog/${slug}/index.html`,

  // Carpetas de Cloudinary donde el panel sube fotos nuevas.
  uploadFolders: {
    blog: 'finite-estudio-web/blog',
    portafolio: 'finite-estudio-web/portafolio',
  },

  categories: ['Lugares', 'Fotografía', 'Planeación'],
  relatedMax: 6,
};
