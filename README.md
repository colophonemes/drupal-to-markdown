# Drupal to Markdown

I have a fairly ambivalent relationship with Drupal, and love static sites, so I wrote a little utility to convert my organisation's Drupal setup to something more portable.

`drupal-to-markdown` is a Node.js utility for scraping data from a Drupal 7 database, transforming the files into nicely-formatted Markdown, handling links and redirection, and outputting the result to a folder, ready to be consumed by your [static site generator](http://www.staticgen.com/) of choice (my favourite is (Metalsmith)[http://metalsmith.io]).

While this was written for a very specific task, it should be pretty easy to adapt to other projects. Depending on some of your custom fields, you may need to change table names.

### Requirements

- Node — (download/install from here)[https://nodejs.org]

### Installation

- Clone/download the repository
- Install dependencies with `npm`

```sh
$ npm install
```

### Config

You can edit `defaults.yml`, or overwrite the defaults by adding your own `config.yml` file.

```yaml

## defaults.yml ##


# Site information
siteURL:            # [String] URL to your existing website. Used to rebuild internal links and to get locally-hosted images. DO NOT include protocol or trailing slash (e.g. example.com)
siteAssetsURL:      # [String] if your images are all hosted in a particular folder (managed by drupal). DO NOT include protocol or trailing slash (e.g example.com/sites/example.com/files)
siteProtocol: https # [String] if your site uses HTTPS, use `https`

# Paths to output directories. Paths will be nested within `basepath`
basePath: ./files           # [String] base path to put all generated assets in
contentPath: /content       # [String] path to main content directory, will nest within `basePath`
pagePath: /pages            # [String] path to regular pages, will nest within `contentPath`
storyPath: /posts           # [String] path to blog posts/stories, will nest within `contentPath`
authorPath: /authors        # [String] path to blog authors, will nest within `contentPath`
imagePath: /images/uploads  # [String] path to store downloaded images, will nest within `contentPath`
staticSitePath: false       # [Boolean] path to copy the assets to when the script completes (useful if you want to build your static site from another directory)

# limitations
nodeLimit: 30        # [Int] how many posts/pages should the script process. Set to zero for no limit/get all posts
skipImages: false    # [Boolean] skip downloading images altogether. The image processor will always use the cache (unless forceImages is true), but if there are images that consistently return 404/500 errors, the script runs much faster if you don't bother making requests on subsequent runs
forceImages: false   # [Boolean] force the script to ignore cached images and try to re-request everything from the server

# MySQL Connection Settings
dbhost: localhost   # [String] Good defaults for MAMP
dbport: 8889        # [Int] Good defaults for MAMP
dbuser: root        # [String] Good defaults for MAMP
dbpassword: root    # [String] Good defaults for MAMP
dbname: drupal      # [String] Name of your database
# MySQL SELECT params
connectionNodeTypes: # [Array] what kinds of nodes should we be looking for in the database
    - 'story'
    - 'page'

```

You can also override config files with command line arguments (mostly you'll want to use for the `skipImages` or `forceImages` settings)

### Usage

```sh
$ node run
```