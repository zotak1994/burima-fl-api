'use strict';
const mongoose = require( 'mongoose' );
const dns = require( 'node:dns' );
const { config } = require( './config' );
const chalk = require('chalk');

const configureDnsForSrvConnection = ( url ) => {
    if( !url || !url.startsWith( 'mongodb+srv://' ) ) {
        return;
    }

    const configuredServers = process.env.MONGO_DNS_SERVERS;
    if( configuredServers ) {
        const servers = configuredServers.split( ',' ).map( ( server ) => server.trim() ).filter( Boolean );
        if( servers.length ) {
            dns.setServers( servers );
            return;
        }
    }

    // Node DNS can fail SRV lookups in some network setups (e.g. Cloudflare WARP
    // on 127.0.2.x refusing c-ares queries -> querySrv ECONNREFUSED); use public
    // resolvers as fallback.
    dns.setServers( [ '1.1.1.1', '8.8.8.8' ] );
};

// Mongo Connection Class
class Connection {
    constructor() {
        const url = config.MONGODB_URI;

        mongoose.Promise = global.Promise;
        // mongoose.set( 'useNewUrlParser', true );
        // mongoose.set( 'useFindAndModify', false );
        // mongoose.set( 'useCreateIndex', true );
        // mongoose.set( 'useUnifiedTopology', true );
        mongoose.set('strictPopulate', false);
        configureDnsForSrvConnection( url );
        this.connect( url ).then( () => {
            // eslint-disable-next-line no-console
            console.log( chalk.greenBright('✔ Database Connected') );
        } ).catch( ( err ) => {
            // eslint-disable-next-line no-console
            const dnsServers = dns.getServers().join( ', ' ) || 'n/a';
            console.error( chalk.redBright(`✘ MONGODB ERROR: ${err.message}` ) );
            if( url && url.startsWith( 'mongodb+srv://' ) ) {
                console.error( chalk.yellowBright( `Mongo SRV DNS servers in use: ${dnsServers}` ) );
                console.error( chalk.yellowBright( 'Tip: set MONGO_DNS_SERVERS="1.1.1.1,8.8.8.8" or use a non-SRV mongodb:// URI.' ) );
            }
        } );

    }

    async connect( url ) {
        try {
            await mongoose.connect( url );
        } catch ( e ) {
            throw e;
        }
    }
}

module.exports = new Connection();
