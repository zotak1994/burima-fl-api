#!/usr/bin/env node
'use strict';
/**
 * Give the stock figures a starting point.
 *
 * Stock is worked out from the confirmed purchases and sales, so stock that
 * no document explains — whatever was already on the shelves when this system
 * came in — would read as zero. This writes that stock as what it actually
 * is: one confirmed purchase per shop, invoiced 'OPENING STOCK', with a line
 * for every product holding bottles nothing else accounts for.
 *
 * That keeps the collections minimal (no adjustment table, no movement log)
 * and it keeps the opening figure visible and editable: it is an ordinary
 * bill on the purchases screen, and correcting it recalculates stock like any
 * other correction.
 *
 * Safe to re-run. It writes ONE such purchase per shop and rewrites its
 * lines, so running it twice does not stack two openings. A product whose
 * stock is fully explained by real documents gets no line at all.
 *
 *   node scripts/opening-stock.js --dry-run          # show, change nothing
 *   node scripts/opening-stock.js --yes              # write it
 *   node scripts/opening-stock.js --shop <id> --date 2026-04-01 --yes
 *
 * Flags
 *   --dry-run   print what would be written and exit (the default)
 *   --yes       actually write
 *   --shop      one shop only, by id
 *   --date      the date to put on the opening purchase (default: today)
 */
const path = require( 'path' );
require( 'dotenv' ).config( { 'path': path.join( __dirname, '..', '.env' ) } );
const mongoose = require( 'mongoose' );
const dns = require( 'node:dns' );

/**
 * The same SRV workaround the app's own database config uses: on some
 * networks the system resolver refuses the _mongodb._tcp lookup an
 * `mongodb+srv://` URI needs.
 */
function configureDns( url ) {
    if ( !url || !url.startsWith( 'mongodb+srv://' ) ) return;
    const configured = process.env.MONGO_DNS_SERVERS;
    if ( configured ) {
        const servers = configured.split( ',' )
            .map( ( s ) => s.trim() )
            .filter( Boolean );
        if ( servers.length ) {
            dns.setServers( servers );
            return;
        }
    }
    dns.setServers( [ '1.1.1.1', '8.8.8.8' ] );
}

const argv = process.argv.slice( 2 );
const has = ( f ) => argv.includes( f );
const val = ( f ) => {
    const i = argv.indexOf( f );
    return i >= 0 ? argv[ i + 1 ] : undefined;
};

const DRY = !has( '--yes' );
const ONLY_SHOP = val( '--shop' );
const OPENING_INVOICE = 'OPENING STOCK';

/** The date to stamp the opening purchase with, as UTC midnight. */
function openingDate() {
    const raw = val( '--date' );
    const when = raw ? new Date( raw ) : new Date();
    if ( Number.isNaN( when.getTime() ) ) {
        throw new Error( `--date is not a date: ${ raw }` );
    }
    return new Date( Date.UTC(
        when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()
    ) );
}

const money = ( n ) => Math.round( ( Number( n ) || 0 ) * 100 ) / 100;

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if ( !uri ) {
        throw new Error( 'MONGODB_URI is not set in .env' );
    }
    configureDns( uri );
    await mongoose.connect( uri );
    console.log( `connected to ${ mongoose.connection.name }` );
    console.log( DRY ? 'DRY RUN — nothing will be written\n' : 'WRITING\n' );

    const { Shop } = require( '../src/modules/shop/shop.model' );
    const { Product } = require( '../src/modules/product/product.model' );
    const { Purchase } = require( '../src/modules/purchase/purchase.model' );
    const { Sale } = require( '../src/modules/sale/sale.model' );
    const { StockService } = require( '../src/modules/stock/stock.service' );
    const { Stock } = require( '../src/modules/stock/stock.model' );

    const ShopModel = new Shop().getInstance();
    const ProductModel = new Product().getInstance();
    const PurchaseModel = new Purchase().getInstance();
    const SaleModel = new Sale().getInstance();
    const stock = new StockService( new Stock().getInstance() );

    const shopFilter = ONLY_SHOP ? { '_id': ONLY_SHOP } : {};
    const shops = await ShopModel.find( shopFilter ).select( 'name' ).lean();
    if ( !shops.length ) {
        console.log( 'no shops matched' );
        return;
    }

    for ( const shop of shops ) {
        console.log( `\n=== ${ shop.name } (${ shop._id }) ===` );

        const products = await ProductModel.find( { 'shop': shop._id } )
            .select( 'name inventory purchasePrice mrp' )
            .lean();

        // What the real documents already account for, ignoring any opening
        // purchase this script wrote before — that one is being replaced.
        const existing = await PurchaseModel.findOne( {
            'shop': shop._id, 'invoiceNo': OPENING_INVOICE
        } ).select( '_id' ).lean();

        const netFrom = async ( Model, sign ) => {
            const match = { 'shop': shop._id, 'status': 'confirmed' };
            if ( existing && Model === PurchaseModel ) {
                match._id = { '$ne': existing._id };
            }
            const rows = await Model.aggregate( [
                { '$match': match },
                { '$unwind': '$items' },
                {
                    '$group': {
                        '_id': '$items.product',
                        'qty': { '$sum': '$items.qty' }
                    }
                }
            ] );
            return rows.map( ( r ) => [ String( r._id ), sign * r.qty ] );
        };
        const accounted = new Map();
        for ( const [ id, qty ] of [
            ...await netFrom( PurchaseModel, 1 ),
            ...await netFrom( SaleModel, -1 )
        ] ) {
            accounted.set( id, ( accounted.get( id ) || 0 ) + qty );
        }

        // The gap: stock the product is holding that no document explains.
        const items = [];
        let unexplained = 0;
        products.forEach( ( p ) => {
            const held = Number( p.inventory ) || 0;
            const gap = held - ( accounted.get( String( p._id ) ) || 0 );
            if ( gap <= 0 ) return;
            unexplained += gap;
            const rate = money( p.purchasePrice || p.mrp || 0 );
            items.push( {
                'product': p._id,
                'name': p.name,
                'qty': gap,
                'rate': rate,
                'amount': money( gap * rate )
            } );
        } );

        console.log(
            `${ products.length } products; ${ items.length } need an opening `
            + `line, ${ unexplained } bottles in total`
        );
        if ( existing ) {
            console.log( `an opening purchase already exists (${ existing._id })`
                + ' — its lines will be replaced' );
        }
        items.slice( 0, 10 ).forEach( ( it ) => {
            console.log( `   ${ it.qty.toString().padStart( 6 ) }  ${ it.name }` );
        } );
        if ( items.length > 10 ) {
            console.log( `   ... and ${ items.length - 10 } more` );
        }

        if ( !items.length && !existing ) {
            console.log( 'nothing to write' );
            continue;
        }
        if ( DRY ) {
            continue;
        }

        const date = openingDate();
        const totalQty = items.reduce( ( s, it ) => s + it.qty, 0 );
        const totalAmount = money(
            items.reduce( ( s, it ) => s + it.amount, 0 )
        );
        const doc = {
            'shop': shop._id,
            'invoiceNo': OPENING_INVOICE,
            'passNo': OPENING_INVOICE,
            date,
            items,
            totalQty,
            totalAmount,
            'lessRebate': 0,
            'specialPurpose': 0,
            'roundOffToGovt': 0,
            'tcs': 0,
            'roundOff': money( Math.round( totalAmount ) - totalAmount ),
            'netAmount': money( Math.round( totalAmount ) ),
            'status': 'confirmed',
            'confirmedAt': new Date()
        };

        if ( existing ) {
            await PurchaseModel.updateOne( { '_id': existing._id }, { '$set': doc } );
            console.log( `rewrote opening purchase ${ existing._id }` );
        } else {
            const made = await PurchaseModel.create( doc );
            console.log( `wrote opening purchase ${ made._id }` );
        }

        // Now work the whole shop's figures out from the documents.
        const rebuilt = await stock.rebuild( { 'shop': String( shop._id ) } );
        console.log(
            `rebuilt: ${ rebuilt.products } products over ${ rebuilt.days } days`
        );
    }

    if ( DRY ) {
        console.log( '\nDRY RUN — nothing was written. Re-run with --yes.' );
    }
}

main()
    .then( () => mongoose.disconnect() )
    .then( () => process.exit( 0 ) )
    .catch( async ( e ) => {
        console.error( '\nFAILED:', e.message );
        await mongoose.disconnect().catch( () => {} );
        process.exit( 1 );
    } );
