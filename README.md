# Panel de contenido · Finite Estudio

Un panel con contraseña para publicar y editar el blog de finiteestudio.com sin tocar código. Cada acción hace un commit real en tu repositorio `finite-estudio-web` y Netlify despliega solo, igual que cuando subes cambios a mano.

## Qué puedes hacer

- **Sitio completo**: abre cualquier página (inicio, paquetes y precios, propuesta, Love Season, recursos, privacidad, gracias, 404 y las herramientas) y edítala de dos maneras sobre el mismo documento. Haz clic en un texto o foto de la página y escribe encima, o usa la pestaña *Secciones* para editar todo en formularios ordenados por sección, con buscador. Se pueden duplicar, mover y eliminar bloques (una reseña, un paquete, una pregunta), cambiar fotos (también subirlas), enlaces, fotos de fondo, y los datos de Google de cada página (título, descripción, foto al compartir). Hay vista de escritorio y de celular, deshacer y rehacer.
- **Blog**: crear, editar y despublicar posts. El panel arma la página con el mismo menú, pixel de Meta, pie de página y estilos de tu blog, genera los datos de Google (Article y FAQPage), actualiza la tarjeta en `/blog/` y la línea del `sitemap.xml`, todo en un solo commit.
- **Vista previa** exacta antes de publicar, y una revisión SEO con el motivo de cada punto.
- **Preguntas frecuentes** de la home: agregar, editar, reordenar.
- **Portafolio** de la home: agregar, quitar, reordenar fotos y escribir su texto alternativo.
- **Subir fotos** directo a Cloudinary (opcional, ver paso 5).

Al despublicar un post el panel borra su página, su tarjeta y su línea del sitemap, deja una redirección al blog en `_redirects` y lo quita de "Sigue leyendo" en los demás posts.

## Despliegue (una sola vez)

1. **Crea un repositorio privado nuevo en GitHub**, por ejemplo `finite-cms`, y sube estos archivos (`index.html`, `netlify.toml`, `package.json`, carpeta `netlify/`). La carpeta `test/` es opcional.
2. **Crea un sitio nuevo en Netlify** conectado a ese repositorio. No necesita comando de build.
3. **Crea un token de GitHub** (Settings → Developer settings → Fine-grained tokens) con acceso solo a `finite-estudio-web` y el permiso *Contents: Read and write*.
4. **Agrega variables de entorno** en Netlify (Site settings → Environment variables):
   - `GITHUB_TOKEN`: el token del paso anterior.
   - `ADMIN_PASSWORD`: la contraseña del panel. Usa una larga y que no uses en otro lado.
5. *(Opcional, para subir fotos desde el panel)* agrega `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET` (están en Cloudinary → Settings → API Keys). Sin ellas el panel funciona igual, pegando la dirección de cada foto.
6. **Redeploy** el sitio para que las funciones tomen las variables.
7. Entra a la URL de Netlify, escribe la contraseña y listo.

Las contraseñas y tokens se escriben solo en el panel de Netlify. No los pegues en chats ni en archivos del repositorio.

## Variables opcionales

| Variable | Para qué | Valor por defecto |
|---|---|---|
| `SITE_REPO` | repositorio del sitio | `sdiazart7-photo/finite-estudio-web` |
| `SITE_BRANCH` | rama | `main` |
| `CLOUDINARY_CLOUD_NAME` | cuenta de Cloudinary | `drrhn6t1c` |

## Cómo está armado

```
index.html                    panel (acceso, blog, sitio, FAQ, portafolio)
editor.js                     editor de páginas (clic directo y formularios)
netlify/functions/
  posts-list.js  post-get.js  post-preview.js  post-save.js  post-delete.js
  pages-list.js  page-get.js  page-save.js
  block-get.js   block-save.js   upload-sign.js
  lib/
    config.js       dominio, rutas, carpetas de Cloudinary, categorías
    blog.js         lee y arma posts, tarjetas, sitemap, redirecciones
    sanitize.js     lista blanca de HTML para el cuerpo
    homeblocks.js   FAQ y portafolio de index.html
    github.js       lectura y commit atómico
    pages.js        páginas editables y validación de guardados
    http.js         contraseña y respuestas
test/                         pruebas contra tus archivos reales
```

El menú, las hojas de estilo, el pixel y el pie de página de cada post se copian de tu propio `blog/index.html`. Si algún día cambias el menú ahí, los posts nuevos lo heredan.

## Cosas que conviene saber

- **Editor del sitio y scripts**: el panel nunca ejecuta ni modifica los scripts de tus páginas (pixel de Meta, carrusel, datos de Google). Se guardan aparte mientras editas y se devuelven idénticos. El servidor rechaza cualquier guardado que cambie un script o agregue controladores como `onclick`.
- **Lo que genera el código de la página** (las fotos del portafolio y las preguntas de la home) se edita en sus pestañas, no en el editor del sitio, porque en el HTML solo existen como datos dentro de un script.
- **Fotos de la página que cambian solas** (por ejemplo el carrusel del hero): en la página se ve la primera. Todas aparecen en *Secciones*.
- **Primer guardado de una página**: el editor reordena detalles menores del código (comillas, un salto de línea). El resultado se ve y funciona igual.
- **Páginas nuevas**: esta versión edita las que ya existen. Crear páginas desde cero no está incluido.

- **Contraseña única**: sirve para uso personal. Si otra persona necesita acceso propio, el siguiente paso sería Netlify Identity.
- **Slug fijo**: la dirección de un post no se cambia después de publicarlo, para no romper enlaces ya indexados.
- **Orden del blog**: las tarjetas se ordenan por fecha, la más reciente arriba.
- **Si GitHub cambia mientras guardas** (otro commit entró primero), el panel avisa y basta con guardar de nuevo.
- **Posts escritos a mano** siguen funcionando. Si cambias la estructura de `blog/index.html` o de `index.html` (FAQ y portafolio), el panel se detiene con un mensaje claro en vez de dañar la página.

## Pruebas

```
SITE_DIR=/ruta/a/finite-estudio-web node test/roundtrip.js   # motor contra tus 9 posts
SITE_DIR=/ruta/a/finite-estudio-web node test/functions.js   # funciones con GitHub simulado
SITE_DIR=/ruta/a/finite-estudio-web node test/devserver.js   # panel local, clave: clave-de-prueba
node test/editor.js                                          # editor del sitio en un navegador real (con el devserver en :8899)
```
