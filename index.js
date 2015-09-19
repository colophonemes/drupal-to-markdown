// command-line args
var args = {};
process.argv.forEach(function (arg) {
    if(arg.indexOf('=')>-1){
        arg = arg.split('=');
        args[arg[0]] = arg[1];
    } else if(arg.substr(0,2)==='--'){
        args[arg] = true;
    }
});
// packages
var mysql       = require('promise-mysql');
var unserialize = require('./unserialize');
var Promise     = require('bluebird');

var cheerio     = require('cheerio');
var tidy = require('htmltidy').tidy;
var toMarkdown  = require('to-markdown');
var beautify_html = require('js-beautify').html;
var moment = require('moment');
var slug = require('slug');
    slug.defaults.mode = 'rfc3986';
var yamljs = require('yamljs')
var clone = require('clone')
var unique = require('array-unique')

var fs          = require('fs');
var path        = require('path');
var rimraf      = require('rimraf');
var mkdirp      = require('mkdirp');
var rsync       = require("rsyncwrapper").rsync;


var http = require('http-request');

var ProgressBar = require('progress');
var chalk = require('chalk');
var alertMsg = chalk.cyan;
var successMsg = chalk.green;
var errorMsg = chalk.bold.red;
var warningMsg = chalk.bold.yellow;
var statusMsg = chalk.dim.gray;

// global vars
var connection;
var nodes = {};
var authors = {};
var files = [];
var images = [];
var missingImages = false;
var missingAuthors = false;
var missingHTML = false;

var basePath = './files';
var contentPath = '/content';
var storyPath = '/posts';
var pagePath = '/pages';
var authorPath = '/authors';
var imagePath = '/images/uploads';
var staticSitePath = '/Users/sam/Sites/GWWC/givingwhatwecan-static/src';



var nodeLimit = args['--limit'] || 30;
var skipImages = args['--skipImages'] || false;

////////////////////////////////////////////////////
///////////////  MAIN CONTROLLER ///////////////////
////////////////////////////////////////////////////

var run = function(){
    var connectionAttempts = 0;
    console.log(chalk.bold.red.bgWhite(' Scraping the GWWC database! '));
    console.log(statusMsg('Scrape started at '+moment().format()));

    promiseWhile(function(){ if(connectionAttempts>10){ throw new Error ( "Cannot connect after 10 attempts" ) }; connectionAttempts++; return !connection},function(){
        console.log(statusMsg('Connecting to MySQL... ',(connectionAttempts>1?'(attempt '+connectionAttempts+')':'') ) );
        return mysql.createConnection({
          host     : 'localhost',
          port     : '8889',
          user     : 'root',
          password : 'root',
          database : 'gwwc_drupal'
        }).then(function(conn){
            connection = conn;
        }).catch(function(err){
            console.error(err);
        });
    })
    .then(function(){
        console.log(statusMsg('connected!'));
    })
    .then(function(){
        console.log('Attempting to get',nodeLimit>0?nodeLimit:'all','nodes from database...');
        return countNodes().then(function(count){
            console.log(statusMsg('There are ',count,'nodes in the database'));
        })
    })
    .then(function(){
        return getNodes().then(function(){
            console.log(alertMsg('Got ',Object.keys(nodes).length,'nodes...'));
        })
    })
    .then(function(){
        // close the connection
        console.log(statusMsg('Closing connection!'));
        connection.end();
    })
    .then(function(){
        return postProcess();
    })
    .then(function(){
        // write posts/pages
        return writeNodes().then(function(){
            console.log(alertMsg('Posts/pages written...'));
        });
    })
    .then(function(){
        // write authors

        return writeAuthors().then(function(){
            console.log(alertMsg('Authors written...'));
        });
    })
    .then(function(){
        // retrieve images
        if(!skipImages){
            console.log('Downloading images...');
            return getImages().then(function(){
                console.log(alertMsg('Images downloaded!'));            
            });
        } else {
            console.log('Skipping image download...');
        }
    })
    .then(function(){
        if(missingImages){
            var missingImagesPath = path.join(basePath, contentPath,'missingImages.yml');
            console.log(warningMsg('Warning, some images could not be found. Please review', missingImagesPath));
            fs.writeFile(missingImagesPath,yamljs.stringify(missingImages),function(err){
                if(err) console.log(errorMsg(err));
            })
        }
        if(missingAuthors.length > 0){
            var missingAuthorsPath = path.join(basePath,contentPath,'missingAuthors.yml');
            console.log(warningMsg('Warning, some posts are missing authors. Please review', missingAuthorsPath));
            fs.writeFile(missingAuthorsPath,yamljs.stringify(missingAuthors),function(err){
                if(err) console.log(errorMsg(err));
            })
        }
    })
    .then(function(){
        // sync data over to the static site folder
        if(staticSitePath){
            var contentDest = path.resolve(staticSitePath);
            var imageDest = path.join(staticSitePath,'images');
            // copy text files from content directory
            return syncContentToStatic(path.join(basePath,contentPath),contentDest)
            .then(function(){
                console.log(alertMsg('Content directory copied to',chalk.bold(contentDest)));
            })
            .then(function(){
                // copy images from image directory
                return syncContentToStatic(path.join(basePath,imagePath),imageDest)
                .then(function(){
                    console.log(alertMsg('Image directory copied to',chalk.bold(imageDest)));
                })
            });
        }
    })
    .then(function(){
        console.log(chalk.bgGreen.black(' Finished Processing! '));
    })
    .catch(function(error){
        console.trace(errorMsg(error));
        exit();
    })
}




////////////////////////////////////////////////////
///////////////  SCRIPT METHODS ////////////////////
////////////////////////////////////////////////////

var exit = function(){
    throw new Error('Exit requested by script')
}

var connectionNodeTypes = ['story','page','raw','special_page_with_view'];
connectionNodeTypes.forEach(function(type,index){
    connectionNodeTypes[index] = '`type`="'+type+'"';
})
var connectionQuery = 'SELECT * FROM `node` WHERE `status`=1 AND ('+connectionNodeTypes.join(' OR ')+') ORDER BY `changed`';

var countNodes = function(){
        return connection.query(connectionQuery).
        then(function(rows){
            return rows.length;
        })
}

var getNodes = function(){
    var limit = nodeLimit > 0 ? ' DESC LIMIT ' + nodeLimit : '';
    return connection.query(connectionQuery + limit)
    .then(function(rows){
        // create a progress bar
        var bar = new ProgressBar(':bar :percent', { total: rows.length-1 });
        
        // promise for loop
        var c = 0;
        return promiseWhile(function(){
            return c < rows.length;
        },function(){
            // create promise for each iteration
            return new Promise(function(resolve, reject) {
                (function() {
                    // set 
                    var node = rows[c],
                        nodeID = node.vid;
                        if(!nodeID){
                            console.log(node);
                            throw new Error ('Warning, no revision ID');
                        }
                    nodes[nodeID] = { title : node.title, nid: node.nid, type: node.type, time: node.created, updated: node.changed };
                    // find the body content of the latest revision
                    connection.query('SELECT `body_value` FROM `field_revision_body` WHERE `revision_id`=' + nodeID)
                    .then(function(rows){
                        if(rows.length>0){
                            // find the contents of the node
                            var contents = rows[0].body_value;
                            // convert HTML to markdown
                            contents = saveContentsAsMarkdown(contents,nodeID);
                            // add contents to node
                            nodes[nodeID].contents = contents;
                        } else {
                            // otherwise log the missing content
                            nodes[nodeID].contents = '';
                            missingHTML = missingHTML || {};
                            missingHTML[node.title] = {html:'',nid:nodeID,error:'No `body_value` in database'}
                        }
                    })
                    .then(function(){
                        // process metatags
                        return connection.query('SELECT `data` from `metatag` WHERE `revision_id`=' + nodeID).
                        then(function(rows){
                            if(rows){
                                rows.forEach(function(row){
                                    var metadata = unserialize(row.data.toString());
                                    if(metadata){
                                        nodes[nodeID].meta = {}
                                        Object.keys(metadata).forEach(function(key){
                                            nodes[nodeID].meta[key] = metadata[key].value;
                                        })
                                    }
                                })
                            }
                        })
                    })
                    .then(function(){
                        // get menu info
                        if(node.type === 'page'){
                            return connection.query('SELECT * from `menu_links` WHERE `menu_name` = "main-menu" AND `hidden`=0 AND `link_path`= "node/'+nodes[nodeID].nid+'"')
                            .then(function(rows){
                                if(rows.length>0){
                                    if(node.title.toLowerCase() !== rows[0].link_title.toLowerCase()) nodes[nodeID].menuTitle = rows[0].link_title;
                                    nodes[nodeID].parentNode = rows[0].plid;
                                    nodes[nodeID].menuOrder = rows[0].weight;
                                    nodes[nodeID].navigation = ['main'];
                                } else {
                                    nodes[nodeID].navigation = false;
                                }
                            })
                        }
                    })
                    .then(function(){
                        // get URL path
                        return connection.query('SELECT `alias` from `url_alias` WHERE `source`= "node/'+nodes[nodeID].nid+'"').then(function(rows){
                            if(rows.length>1) {console.log('********',rows); throw new Error ('why so many aliases?');}
                            if(rows.length===0) {console.log('********',rows); throw new Error ('Why no alias?');}
                            nodes[nodeID].alias = rows[0].alias;
                            nodes[nodeID].redirects = nodes[nodeID].redirects ? nodes[nodeID].redirects.concat(rows[0].alias) : [rows[0].alias];
                        })
                    })
                    .then(function(){
                        // get any URLs that redirect to this node
                        return connection.query('SELECT `source` from `redirect` WHERE `redirect`= "node/'+nodes[nodeID].nid+'"').then(function(rows){
                            if(rows.length>0){
                                rows.forEach(function(row){
                                    nodes[nodeID].redirects = nodes[nodeID].redirects ? nodes[nodeID].redirects.concat(row.source) : [row.source];
                                });
                            }
                        })
                    })
                    .then(function(){
                        // extra processing for blog posts
                        if(node.type === 'story'){
                            // get author taxonomy ID for the current node
                            return connection.query('SELECT * FROM `field_revision_field_author` WHERE `revision_id`='+nodeID)
                            .then(function(rows){
                                if(rows.length>0){
                                    // find any author_profiles with the same author taxonomy ID
                                    tid = rows[0].field_author_tid;
                                    return connection.query('SELECT `revision_id` FROM `field_revision_field_author` WHERE `bundle`="author_profile" AND `field_author_tid`='+tid)
                                } else {
                                    missingAuthors.push([node.title,node.nid]);
                                }
                            })
                            .then(function(rows){
                                if(rows && rows.length>0){
                                    // use the revision ID of the author taxonomy id to link the author to the current node
                                    a = rows[0].revision_id;
                                    nodes[nodeID].author = a;
                                    return connection.query('SELECT `body_value` FROM `field_revision_body` WHERE `revision_id`='+rows[0].revision_id)
                                    .then(function(rows){
                                        // add body text to author profile
                                        var contents = rows[0] ? rows[0].body_value : '';
                                        contents = saveContentsAsMarkdown(contents,tid);
                                        authors[a] = {
                                            contents : contents
                                        };
                                        // find the author's name from the taxonomy terms
                                        return connection.query('SELECT `name` FROM `taxonomy_term_data` WHERE `tid`='+tid);
                                    })
                                    .then(function(rows){
                                        // add the author's name
                                        authors[a].name = rows[0].name;
                                        // find image associated with the author node
                                        return connection.query('SELECT `field_image_fid` FROM `field_data_field_image` WHERE `revision_id`='+a);
                                    })
                                    .then(function(rows){
                                        // find the path associated with the author's featured image
                                        return connection.query('SELECT `filename` FROM `file_managed` WHERE `fid`='+rows[0].field_image_fid);
                                    })
                                    .then(function(rows){
                                        // add the featured image to the author
                                        var file = slug(path.basename(decodeURIComponent(rows[0].filename)));
                                        authors[a].image = path.join(imagePath,file);

                                        images.push({
                                            file:   file,
                                            url:    "https://www.givingwhatwecan.org/sites/givingwhatwecan.org/files/" + rows[0].filename
                                        })
                                    })
                                } else {
                                    missingAuthors = missingAuthors ? missingAuthors.concat([node.title,node.nid]) : [[node.title,node.nid]];
                                }
                            })
                        }
                    })                    
                    .then(function(){
                        // move to the next row and return the promise
                        if(!bar.complete){
                            bar.tick();
                        }
                        c++;
                        resolve();
                    })
                    .catch(function(err){
                        console.error(err);
                        console.log('Current node:');
                        console.log(node);
                        exit();
                    })

                })()
            })
        })
    })

}




var promiseWhile = function(condition, action) {
    var resolver = Promise.defer();

    var loop = function() {
        if (!condition()) return resolver.resolve();
        return Promise.cast(action())
            .then(loop)
            .catch(resolver.reject);
    };

    process.nextTick(loop);

    return resolver.promise;
};


var logMessage = function(title,message){
    console.log("\n\n",title,"\n\n",message);
}

var localURL = function(url){
    return url ? url.search('://givingwhatwecan.org/') > -1 || url.search('://www.givingwhatwecan.org/') > -1 || url.search('://') < 0 : false;
}
var getAbsoluteURL = function(url){
    if (localURL(url) && url.search('://') < 0){
        url = 'https://givingwhatwecan.org'+(url.substr(0,1)==='/'?'':'/')+url;
    }
    return url;
}

var removeTags = function(input,open,close){
    var start, end, output;
    start = input.indexOf(open);
    if(start>-1){
        end = input.indexOf(close);
        if(end>-1){
            // go past the end of the tag
            end+=2;
            output = input.slice(0,start)+ input.slice(end);
            return removeTags(output);
        }
        else {
            throw new Error('Opening',open,'tag but no closing',close,'tag!');
        }
    } else {
        return input;
    }
}

var saveContentsAsMarkdown = function(input,nodeID){
    // remove PHP tags
    var input = removeTags(input,'<?','?>');
    // var input = removeTags(input,'<script>','</script>');
    // tidy our HTML
    tidy(input, { 
        "show-body-only": 'y',
        "wrap":0
    }, function(err, html) {
        if (err) throw new Error (err)
        input = html;
    });
    // process tags
    $ = cheerio.load(input);
    // process images
    $('img').each(function(){
        // replace absolute references to local images with a relative path
        var src = $(this).attr('src');
        var local = localURL(src);
        imgSlug = slug(path.basename(decodeURIComponent(src)));
        var file = local ? imgSlug : src;
        images.push({file:file,url:src});
        if(local){
            src = path.join(imagePath, imgSlug );
            $(this).attr('src',src);
        }
    })
    // process links
    $('a').each(function(){
        var classes = [];
        var a = $(this);
        var href = a.attr('href');
        // replace absolute internal URLs with relative ones
        href = href;
        // find internal files and move them into an appropriate folder
        if(path.extname(href)==='.pdf' && localURL(href)){
            files.push({file:path.basename(href),url:href});
            href = '/files/' + path.basename(href)
        }
        if(a.children('img').length === 0){
            if(a.hasClass('join')){
                classes.push('btn')
                classes.push('btn-primary');
            } 
            if(a.hasClass('linkbuttonbig')){
                classes.push('btn');
                classes.push('btn-primary')
                classes.push('btn-large');
            }
        }
        // remove all attributes
        var attributes = Object.keys(a[0].attribs);
        attributes.forEach(function(item) {
            a.removeAttr(item);
        });
        // give the href attribute back
        a.attr('href',href);
        if (name.length > 0) a.attr('name',href);
        // add any classes
        classes = unique(classes);
        a.addClass(classes.join(' '));

    });

    // remove script tags
    $('script').remove();
    // unwrap superfluous div/span tags
    $("div, span").replaceWith(function () {
        return $(this).contents();
    });
    // save HTML as Markdown
    input = $.html();


    // remove all non-space whitespace characters from pages, which can break the build
    input = input.replace(/[^\S ]/g,'');
    try {
        input = toMarkdown(input, {
            gfm: true,
            converters: [
                {
                    // return links with a class attribute as raw HTML
                    filter: function (node) {
                      return node.nodeName === 'A' && node.getAttribute('href') && node.getAttribute('class');
                    },
                    replacement: function(content, node) {
                      var titlePart = node.title ? ' title="'+ node.title +'"' : '';
                      return '<a href="' +node.getAttribute('href') + '" class="'+node.getAttribute('class')+'"'+titlePart+">" + content + '</a>';
                    }
                }
            ]
        });
    } catch (err) {
        input = 'This page con'
        missingHTML = missingHTML || {};
        var title = nodes[nodeID].title|| nodes[nodeID].name;
        missingHTML[title] = {html:input,nid:nodeID,error:err}
    }
    // if(nodes[nodeID] && nodes[nodeID].title === 'Homepage'){
    //     console.dir(input); exit();
    // }
    return input;
}

var postProcess = function(){
    return new Promise(function(resolve,reject){

        // post-process Nodes
        Object.keys(nodes).forEach(function(nodeID, index){
            // shorten node contents
            // nodes[nodeID].contents = nodes[nodeID].contents.substr(0,10)+'...'
            // remove robots meta
            if(nodes[nodeID].meta){
                delete nodes[nodeID].meta.robots
                delete nodes[nodeID].meta['og:image:secure_url']
                if(nodes[nodeID].meta['og:image'] && localURL(nodes[nodeID].meta['og:image'])){
                    var src = nodes[nodeID].meta['og:image'];
                    images.push({file:path.basename(src),url:src});
                    nodes[nodeID].meta['ogImage'] = path.join(imagePath,path.basename(src));
                    delete nodes[nodeID].meta['og:image'];
                }
            }

            /*if(nodes[nodeID].title.indexOf(':') > -1 ){
                console.log('Title contains a colon',nodes[nodeID].title);
                nodes[nodeID].title = nodes[nodeID].title.replace(/:/g,' -- ');
                console.log('Changed to',nodes[nodeID].title);
            }*/

        })
        resolve();
    })
}

var writeNodes = function(){


    return new Promise(function(resolve,reject){

        // clear out old posts
        rimraf(path.join(basePath,contentPath,storyPath), function(err){
            if(err) throw new Error (err)
            // clear out old pages
            rimraf(path.join(basePath,contentPath,pagePath), function(err){
                if(err) throw new Error (err)
                // loop over Nodes
                Object.keys(nodes).forEach(function(nodeID,index){
                    var node = nodes[nodeID];

                    if(node.type==='story'){  // process blog posts
                        // add author info 
                        if(node.author && authors[node.author]){
                            node.author = slug(authors[node.author].name);
                        } else {
                            node.author = false;
                        }
                    } else {  // process other nodes
                        // add a parent to any child node
                        if(path.dirname(node.alias) !== '.'){
                            node.parent = path.dirname(node.alias);
                        }
                        if(!node.menuTitle){
                            // if we have an alias, generate a menuTitle from it by converting underscores to spaces and uppercasing words
                            var menuTitle = path.basename(node.alias).replace(/-/g,' ').replace( /\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase() ;});
                            if (menuTitle.toLowerCase() !== node.title.toLowerCase()) node.menuTitle = menuTitle;
                        }
                        if(node.alias == 'homepage'){
                            node.alias = './';
                        }
                    }
                    node.slug = node.alias;

                    // add dates in correct format
                    var date = new Date(node.time*1000);
                    var updated = new Date(node.updated*1000);
                    node.date = moment(date).format('YYYY-MM-DD');
                    delete node.time; //hacky thing to get metadata ordered more nicely
                    node.time = moment(date).format('hh:mma');
                    node.updatedDate = moment(updated).format('YYYY-MM-DD');
                    node.updatedTime = moment(date).format('hh:mma');


                    // clone a new object so that deletions won't pollute our master node object
                    var meta = clone(node);
                    // get rid of keys we don't want in the metadata
                    ['contents','nid','type','alias','updated','parentNode'].forEach(function(key){
                        delete meta[key];
                    });
                    // build the output file as a string
                    var output = '';
                    output += '---\n';
                    output += yamljs.stringify(meta);
                    output += '---\n';
                    output += node.contents;
                    // create the main content directory if it doesn't already exist
                    mkdirp(path.join(basePath,contentPath), function(err){
                        if(err){
                            console.log(errorMsg(err))
                            reject();
                        }
                        // set  folder names
                        var filename = node.alias === './' ? 'index.md' : slug( node.menuTitle ? node.menuTitle  : node.title)+'.md';
                        var folder = node.type === 'story' ? path.join(basePath,contentPath, storyPath) : path.join(basePath,contentPath, pagePath, path.dirname(node.alias) );
                        var filePath = path.join(folder,(node.type === 'story' ? moment(date).format('YYYY-MM-DD')+'-' : '')+filename);
                        // create the destination directory if it doesn't exist
                        mkdirp(folder, function(err){
                            if(err){
                                console.log(errorMsg(err))
                                reject();
                            }
                            // write the file
                            fs.writeFile(filePath,output,function(err){
                                if(err){
                                    console.log(errorMsg(err))
                                    reject();
                                }
                                // if we've written the last node, resolve the promise
                                if(Object.keys(nodes).length-1 === index){
                                    resolve();
                                }
                            })
                        })
                    })
                });

            })
        })
    })
    
}

var writeAuthors = function(){
    // clear out old authors
    return new Promise(function(resolve,reject){
        rimraf(path.join(basePath,contentPath,authorPath), function(){
            Object.keys(authors).forEach(function(authorid,index){
                var author = authors[authorid];
                var meta = clone(author);
                // get rid of keys we don't want in the metadata
                ['contents'].forEach(function(key){
                    delete meta[key];
                });                
                // build the output file as a string
                var output = '';
                output += '---\n';
                output += yamljs.stringify(meta);
                output += '---\n';
                output += author.contents;
                // write the file
                mkdirp(path.join(basePath,contentPath), function(err){
                    if(err){
                        console.log(errorMsg(err))
                        reject();
                    }
                    var folder = path.join(basePath,contentPath,authorPath);
                    var filePath = path.join(folder,slug(author.name)+'.md');
                    mkdirp(folder, function(err){
                        if(err){
                            console.log(errorMsg(err))
                            reject();
                        }
                        fs.writeFile(filePath,output,function(err){
                            if(err){
                                console.log(errorMsg(err))
                                reject();
                            }
                            if(Object.keys(authors).length-1 === index){
                                resolve();
                            }
                        })
                    })
                })
            });

        });
    });
}

var getImages = function(force){

    var c = 0;
    var bar = new ProgressBar(':bar :percent', { total: images.length-1 });

    // check our directory exists
    var imageFolder = path.join(basePath,imagePath);
    mkdirp.sync(imageFolder)
    // get a list of existing image files
    var existingImageFiles = fs.readdirSync(imageFolder);
    existingImageFiles.forEach(function(filename,i){
        existingImageFiles[i] = filename.toLowerCase();
    })
    return promiseWhile(function(){
        return c < images.length;
    },function(){
        // create promise for each iteration
        return new Promise(function(resolve,reject){
            (function() {
                force = force || false;
                image = images[c];
                if(!bar.complete){
                    bar.tick();
                }
                if(localURL(image.url)){
                    // only bother making a http request if we don't have the file in our list of existing files, or we want to force download
                    if(existingImageFiles.indexOf(image.file.toLowerCase()) === -1 || force){
                        var imageURL = getAbsoluteURL(image.url);
                        var filePath = path.join(imageFolder,image.file)
                        // so, run the HTTP request
                        http.get({url:imageURL}, filePath, function (error, result) {
                            // if we can't find the file, add it to the global list of missing images
                            if (error) {
                                missingImages = missingImages || {};
                                missingImages[path.join(imagePath,image.file)] = imageURL;
                                c++;
                                resolve();
                            } else {
                                c++;
                                resolve();
                            }
                        });
                    } else {
                        c++;
                        resolve();
                    }
                } else {
                    c++;
                    resolve();
                }
            })();
        });
    });
}



function syncContentToStatic(src, dest){
    return new Promise(function(resolve,reject){
        // check that the destination directory exists
        mkdirp(dest,function(){
            // call rsync
            rsync({
                src: src,
                dest: dest,
                recursive: true,
                deleteAll: true,
                onStdout: function (data) { console.log(data.toString()) },
                onStderr: function (data) { console.log(errorMsg(data.toString())) }
            },function(error,stdout,stderr,cmd){
                if(error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        })
    })
}




run();
