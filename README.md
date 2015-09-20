# Drupal to Markdown

A Node.js utility for scraping data from a Drupal 7 database, transforming the files into nicely-formatted Markdown, handling links and redirection, and .

While this was written for a very specific task, it should be pretty easy to adapt to other projects.

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

You can also override config files with command line arguments (mostly you'll want to use for the `skipImages` or `forceImages` settings)

### Usage

```sh
$ node run
```