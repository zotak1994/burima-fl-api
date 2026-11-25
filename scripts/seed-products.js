'use strict';
/**
 * Seed demo products for one shop.
 *
 * Every product it writes carries a code with a known prefix (SEED- by
 * default), which is what makes the whole batch removable again in one go and
 * keeps a re-run from duplicating rows. Nothing that already exists is
 * touched: missing mother categories, categories, companies and measurements
 * are created by name, existing ones are reused.
 *
 *   node scripts/seed-products.js                    # 100 products, first shop
 *   node scripts/seed-products.js --count 250
 *   node scripts/seed-products.js --shop "Bazar Café"
 *   node scripts/seed-products.js --dry-run          # report, write nothing
 *   node scripts/seed-products.js --undo             # delete this prefix again
 *
 * Options:
 *   --count <n>     how many seeded products the shop should end up with
 *                   (default 100). A re-run at the same count does nothing;
 *                   a higher count tops the batch up.
 *   --shop <name>   shop name (case-insensitive) or _id; default: the first shop
 *   --prefix <s>    product-code prefix for the batch (default SEED-)
 *   --dry-run       print the plan and exit without writing
 *   --undo          delete every product in that shop whose code has the prefix
 *   --yes           skip the confirmation prompt (for --undo)
 */

// .env first: the config module reads process.env when it is required.
require( 'dotenv' ).config();
const mongoose = require( 'mongoose' );
const dns = require( 'node:dns' );
const { config } = require( '../system/configs/config' );

/**
 * The same SRV workaround the server applies in system/configs/database.js:
 * Node's own resolver refuses SRV lookups in some network setups, and a
 * mongodb+srv:// URI cannot resolve without it.
 * @param { string } url
 */
function configureDnsForSrvConnection( url ) {
    if ( !url || !url.startsWith( 'mongodb+srv://' ) ) return;
    const configured = process.env.MONGO_DNS_SERVERS;
    if ( configured ) {
        const servers = configured.split( ',' ).map( ( s ) => s.trim() ).filter( Boolean );
        if ( servers.length ) {
            dns.setServers( servers );
            return;
        }
    }
    dns.setServers( [ '1.1.1.1', '8.8.8.8' ] );
}

const { Product } = require( '../src/modules/product/product.model' );
const { Shop } = require( '../src/modules/shop/shop.model' );
const { Category } = require( '../src/modules/category/category.model' );
const {
    MotherCategory
} = require( '../src/modules/mothercategory/mothercategory.model' );
const { Company } = require( '../src/modules/company/company.model' );
const { Capacity } = require( '../src/modules/capacity/capacity.model' );

/* ------------------------------- arguments ------------------------------ */

function parseArgs( argv ) {
    const args = {
        'count': 100,
        'shop': null,
        'prefix': 'SEED-',
        'dryRun': false,
        'undo': false,
        'yes': false
    };
    for ( let i = 0; i < argv.length; i++ ) {
        const arg = argv[ i ];
        if ( arg === '--dry-run' ) args.dryRun = true;
        else if ( arg === '--undo' ) args.undo = true;
        else if ( arg === '--yes' || arg === '-y' ) args.yes = true;
        else if ( arg === '--count' ) args.count = Number( argv[ ++i ] );
        else if ( arg === '--shop' ) args.shop = argv[ ++i ];
        else if ( arg === '--prefix' ) args.prefix = String( argv[ ++i ] );
        else {
            throw new Error( `Unknown option "${ arg }". See the header of this file.` );
        }
    }
    if ( !Number.isInteger( args.count ) || args.count < 1 || args.count > 5000 ) {
        throw new Error( '--count must be a whole number between 1 and 5000.' );
    }
    args.prefix = args.prefix.trim().toUpperCase();
    if ( !args.prefix ) {
        throw new Error( '--prefix cannot be empty: it is what makes --undo safe.' );
    }
    return args;
}

/* ------------------------------ demo catalogue -------------------------- */
// Invented brands, so nothing here claims to be a real product's real price.

const MOTHER_CATEGORIES = [ 'IMFL', 'BEER', 'WINE', 'COUNTRY LIQUOR' ];

const CATEGORIES = [
    'WHISKY', 'RUM', 'VODKA', 'GIN', 'BRANDY', 'BEER', 'WINE', 'TEQUILA',
    'COUNTRY SPIRIT'
];

const COMPANIES = [
    'Highland Crest Distillers', 'Blue Harbour Beverages',
    'Royal Sundar Distillery', 'Kingsway Breweries',
    'Monsoon Valley Vintners', 'Aurora Spirits',
    'Teesta Liquors', 'Silk Route Imports'
];

/** The brand each company puts on the bottle, so product names read right. */
const BRANDS = {
    'Highland Crest Distillers': 'Highland Crest',
    'Blue Harbour Beverages': 'Blue Harbour',
    'Royal Sundar Distillery': 'Royal Sundar',
    'Kingsway Breweries': 'Kingsway',
    'Monsoon Valley Vintners': 'Monsoon Valley',
    'Aurora Spirits': 'Aurora',
    'Teesta Liquors': 'Teesta',
    'Silk Route Imports': 'Silk Route'
};

// name -> volume in ml. Names follow the style already in the database
// ("750 ML"), so a seed run reuses those rows instead of adding near
// duplicates that differ only in spelling.
const CAPACITIES = {
    '90 ML': 90,
    '180 ML': 180,
    '375 ML': 375,
    '650 ML': 650,
    '750 ML': 750
};

/** Which measurements and pack sizes make sense for each category. */
const SHAPE = {
    'WHISKY': { 'mother': 'IMFL', 'sizes': [ '180 ML', '375 ML', '750 ML' ], 'perCase': 12, 'mrp': [ 320, 4200 ] },
    'RUM': { 'mother': 'IMFL', 'sizes': [ '180 ML', '750 ML' ], 'perCase': 12, 'mrp': [ 240, 1600 ] },
    'VODKA': { 'mother': 'IMFL', 'sizes': [ '180 ML', '750 ML' ], 'perCase': 12, 'mrp': [ 280, 2400 ] },
    'GIN': { 'mother': 'IMFL', 'sizes': [ '375 ML', '750 ML' ], 'perCase': 12, 'mrp': [ 450, 3200 ] },
    'BRANDY': { 'mother': 'IMFL', 'sizes': [ '180 ML', '750 ML' ], 'perCase': 12, 'mrp': [ 300, 1800 ] },
    'TEQUILA': { 'mother': 'IMFL', 'sizes': [ '750 ML' ], 'perCase': 6, 'mrp': [ 1800, 6500 ] },
    'BEER': { 'mother': 'BEER', 'sizes': [ '650 ML' ], 'perCase': 12, 'mrp': [ 120, 260 ] },
    'WINE': { 'mother': 'WINE', 'sizes': [ '750 ML' ], 'perCase': 6, 'mrp': [ 550, 3800 ] },
    'COUNTRY SPIRIT': { 'mother': 'COUNTRY LIQUOR', 'sizes': [ '90 ML', '180 ML' ], 'perCase': 48, 'mrp': [ 60, 180 ] }
};

const RANGES = [
    'Reserve', 'Select', 'Classic', 'Gold', 'Black Label', 'Heritage',
    'Signature', 'No. 7', 'Blue', 'Royale', 'Premium', 'Original'
];

/** Deterministic pseudo-random, so two runs produce the same catalogue. */
function rng( seed ) {
    let s = seed;
    return () => {
        s = ( s * 1103515245 + 12345 ) % 2147483648;
        return s / 2147483648;
    };
}

/**
 * Build the product rows. Pure — it only needs the resolved lookup ids, so
 * the shape of the data can be reviewed with --dry-run before anything writes.
 */
function buildProducts( { count, prefix, shopId, ids, startIndex } ) {
    const rand = rng( 20261121 );
    const pick = ( list ) => list[ Math.floor( rand() * list.length ) ];
    const rows = [];

    for ( let i = 0; i < count; i++ ) {
        const n = startIndex + i;
        const catName = CATEGORIES[ n % CATEGORIES.length ];
        const shape = SHAPE[ catName ];
        const sizeName = shape.sizes[ n % shape.sizes.length ];
        const companyName = COMPANIES[ n % COMPANIES.length ];

        // Price scales with the bottle, so the numbers look like a real list.
        const ml = CAPACITIES[ sizeName ];
        const [ lowMrp, highMrp ] = shape.mrp;
        const span = highMrp - lowMrp;
        const sizeFactor = ml / 750;
        const base = lowMrp + ( span * rand() );
        const mrp = Math.max( 20, Math.round( base * sizeFactor / 10 ) * 10 );
        // A shop buys below MRP; 70-82% of it is the usual spread.
        const purchasePrice = Math.round( mrp * ( 0.70 + ( rand() * 0.12 ) ) );

        // The brand comes from the company actually assigned to the row, so
        // the name and the company column agree with each other.
        const brand = BRANDS[ companyName ];
        const kind = catName.replace( /\w+/g, ( w ) =>
            w[ 0 ] + w.slice( 1 ).toLowerCase() );
        const name = `${ brand } ${ pick( RANGES ) } ${ kind } ${ sizeName }`;

        rows.push( {
            'name': name,
            'code': `${ prefix }${ String( n ).padStart( 4, '0' ) }`,
            'shop': shopId,
            'motherCategory': ids.motherCategories[ shape.mother ],
            'category': ids.categories[ catName ],
            'company': ids.companies[ companyName ],
            'capacity': ids.capacities[ sizeName ],
            'mrp': mrp,
            'purchasePrice': purchasePrice,
            'mainUnit': 'BOTTLE',
            'alternateUnit': 'CASE',
            'perAlternateUnitQty': shape.perCase,
            'stockAlertQty': shape.perCase,
            // New products start empty: stock only ever arrives by confirming a
            // purchase, and the stock report is derived from those documents,
            // so a seeded inventory would just disagree with the report.
            'inventory': 0,
            'displayNumber': n,
            'status': rand() > 0.08
        } );
    }
    return rows;
}

/* -------------------------------- helpers ------------------------------- */

/** Case-insensitive exact name match, so a re-run reuses what is there. */
function nameFilter( name ) {
    const escaped = name.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
    return { 'name': { '$regex': `^${ escaped }$`, '$options': 'i' } };
}

/**
 * Resolve each name to an _id, creating the ones that do not exist yet.
 * @returns { Promise<{ map: Object, created: string[] }> }
 */
async function ensureLookups( Model, names, extraFor, dryRun ) {
    const map = {};
    const created = [];
    let displayNumber = await Model.countDocuments( {} );

    for ( const name of names ) {
        const found = await Model.findOne( nameFilter( name ) ).select( '_id' ).lean();
        if ( found ) {
            map[ name ] = found._id;
            continue;
        }
        created.push( name );
        if ( dryRun ) {
            map[ name ] = new mongoose.Types.ObjectId();
            continue;
        }
        displayNumber += 1;
        const doc = await Model.create( {
            'name': name,
            'displayNumber': displayNumber,
            'status': true,
            ...( extraFor ? extraFor( name ) : {} )
        } );
        map[ name ] = doc._id;
    }
    return { map, created };
}

/** The shop to seed into: by id, by name, or just the first one there is. */
async function resolveShop( ShopModel, wanted, dryRun ) {
    if ( wanted && mongoose.Types.ObjectId.isValid( wanted ) ) {
        const byId = await ShopModel.findById( wanted ).select( 'name' ).lean();
        if ( byId ) return { shop: byId, createdShop: false };
    }
    if ( wanted ) {
        const byName = await ShopModel.findOne( nameFilter( wanted ) )
            .select( 'name' ).lean();
        if ( byName ) return { shop: byName, createdShop: false };
        throw new Error(
            `No shop matches "${ wanted }". Run without --shop to use the first one.`
        );
    }

    const first = await ShopModel.findOne( {} )
        .sort( { 'displayNumber': 1, 'createdAt': 1 } ).select( 'name' ).lean();
    if ( first ) return { shop: first, createdShop: false };

    // An empty database still needs somewhere to put the products.
    if ( dryRun ) {
        return {
            'shop': { '_id': new mongoose.Types.ObjectId(), 'name': 'Main Shop' },
            'createdShop': true
        };
    }
    const made = await ShopModel.create( {
        'name': 'Main Shop',
        'phone': '0000000000',
        'displayNumber': 1,
        'status': true
    } );
    return { 'shop': { '_id': made._id, 'name': made.name }, 'createdShop': true };
}

/** A y/N prompt on the terminal; auto-yes when stdin is not a terminal. */
function confirmPrompt( question ) {
    if ( !process.stdin.isTTY ) return Promise.resolve( false );
    return new Promise( ( resolve ) => {
        process.stdout.write( `${ question } [y/N] ` );
        process.stdin.setEncoding( 'utf8' );
        process.stdin.once( 'data', ( data ) => {
            process.stdin.pause();
            resolve( /^y(es)?$/i.test( String( data ).trim() ) );
        } );
    } );
}

/* --------------------------------- main --------------------------------- */

async function main() {
    const args = parseArgs( process.argv.slice( 2 ) );

    if ( !config.MONGODB_URI ) {
        throw new Error( 'MONGODB_URI is not set — check the .env file.' );
    }
    configureDnsForSrvConnection( config.MONGODB_URI );
    await mongoose.connect( config.MONGODB_URI );
    // Which database, printed plainly: seeding the wrong one is the mistake
    // worth preventing here.
    console.log( `database: ${ mongoose.connection.name }` );

    const ProductModel = new Product().getInstance();
    const ShopModel = new Shop().getInstance();
    const CategoryModel = new Category().getInstance();
    const MotherCategoryModel = new MotherCategory().getInstance();
    const CompanyModel = new Company().getInstance();
    const CapacityModel = new Capacity().getInstance();

    const { shop, createdShop } = await resolveShop(
        ShopModel, args.shop, args.dryRun
    );
    console.log( `shop:     ${ shop.name }${ createdShop ? '  (created)' : '' }` );
    console.log( `prefix:   ${ args.prefix }` );

    const codeFilter = {
        'shop': shop._id,
        'code': { '$regex': `^${ args.prefix.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) }` }
    };

    /* ------------------------------- undo ------------------------------- */
    if ( args.undo ) {
        const doomed = await ProductModel.countDocuments( codeFilter );
        if ( !doomed ) {
            console.log( `\nNothing to remove: no ${ args.prefix }* products in this shop.` );
            return;
        }
        console.log( `\nThis will DELETE ${ doomed } product(s) coded ${ args.prefix }* in "${ shop.name }".` );
        console.log( 'Products you entered yourself are untouched — only this prefix is matched.' );
        if ( args.dryRun ) {
            console.log( 'Dry run: nothing deleted.' );
            return;
        }
        const ok = args.yes || await confirmPrompt( 'Delete them?' );
        if ( !ok ) {
            console.log( 'Cancelled. Nothing was deleted.' );
            return;
        }
        const res = await ProductModel.deleteMany( codeFilter );
        console.log( `Deleted ${ res.deletedCount } product(s).` );
        return;
    }

    /* ------------------------------ seeding ----------------------------- */
    const existing = await ProductModel.find( codeFilter ).select( 'code' ).lean();
    const taken = new Set( existing.map( ( p ) => p.code ) );
    if ( taken.size ) {
        console.log( `already present: ${ taken.size } product(s) coded ${ args.prefix }*` );
    }

    const motherCategories = await ensureLookups(
        MotherCategoryModel, MOTHER_CATEGORIES, null, args.dryRun
    );
    const categories = await ensureLookups(
        CategoryModel, CATEGORIES, null, args.dryRun
    );
    const companies = await ensureLookups(
        CompanyModel, COMPANIES, null, args.dryRun
    );
    const capacities = await ensureLookups(
        CapacityModel, Object.keys( CAPACITIES ),
        ( name ) => ( { 'volumeMl': CAPACITIES[ name ] } ), args.dryRun
    );

    const newLookups = [
        [ 'mother categories', motherCategories.created ],
        [ 'categories', categories.created ],
        [ 'companies', companies.created ],
        [ 'measurements', capacities.created ]
    ].filter( ( [ , list ] ) => list.length );
    if ( newLookups.length ) {
        console.log( 'lookups to create:' );
        newLookups.forEach( ( [ label, list ] ) => {
            console.log( `  ${ label }: ${ list.join( ', ' ) }` );
        } );
    } else {
        console.log( 'lookups:  all already present' );
    }

    // --count is the number the shop should END UP with, so the batch is
    // built as codes 1..count and the ones already there are dropped. A plain
    // re-run therefore does nothing instead of adding a second batch, and
    // raising --count tops the existing batch up.
    const candidates = buildProducts( {
        'count': args.count,
        'prefix': args.prefix,
        'shopId': shop._id,
        'ids': {
            'motherCategories': motherCategories.map,
            'categories': categories.map,
            'companies': companies.map,
            'capacities': capacities.map
        },
        'startIndex': 1
    } );
    const rows = candidates.filter( ( r ) => !taken.has( r.code ) );

    console.log( `\nproducts to insert: ${ rows.length }` );
    if ( rows.length ) {
        const sample = rows[ 0 ];
        console.log(
            `  e.g. ${ sample.code }  ${ sample.name }  ` +
            `MRP ${ sample.mrp }  buy ${ sample.purchasePrice }  ` +
            `stock ${ sample.inventory }`
        );
    }

    if ( args.dryRun ) {
        console.log( '\nDry run: nothing was written.' );
        return;
    }
    if ( !rows.length ) {
        console.log( 'Nothing to do.' );
        return;
    }

    // ordered: true — stop at the first bad row rather than writing a partial
    // batch whose gaps are invisible afterwards.
    const inserted = await ProductModel.insertMany( rows, { 'ordered': true } );
    console.log( `\n✔ Inserted ${ inserted.length } products into "${ shop.name }".` );
    console.log( `  Remove them again: node scripts/seed-products.js --undo --prefix ${ args.prefix }` );
}

main()
    .catch( ( err ) => {
        console.error( `\n✘ ${ err.message }` );
        if ( err.errors ) {
            Object.values( err.errors ).forEach( ( e ) => {
                console.error( `  - ${ e.message }` );
            } );
        }
        process.exitCode = 1;
    } )
    .finally( async () => {
        await mongoose.disconnect().catch( () => {} );
    } );
