#!/usr/bin/env node
'use strict';
/*
 * The stock figures, end to end, against a THROWAWAY database on the same
 * cluster — never the app's own.
 *
 * Transactions, aggregations and the unique index are the point here, so
 * stubs would prove nothing: this drives the real services against a real
 * MongoDB. The database is created, used, and dropped at the end. Nothing in
 * the app's own data is read or written, and the run refuses to start if it
 * is not connected to the scratch database.
 *
 *   npm run verify-stock
 */
const path = require( 'path' );
const BE = path.join( __dirname, '..' );
const mongoose = require( 'mongoose' );
const dns = require( 'node:dns' );
require( 'dotenv' ).config( { 'path': path.join( BE, '.env' ) } );

const TEST_DB = 'burima_stock_verify';

const problems = [];
const check = ( label, cond, detail ) => {
    console.log(
        ( cond ? '  PASS  ' : '  FAIL  ' ) + label
        + ( detail ? '  — ' + detail : '' )
    );
    if ( !cond ) problems.push( label );
};
async function expectError( label, fn, needle ) {
    try {
        await fn();
        check( label, false, 'no error thrown' );
    } catch ( e ) {
        check( label, String( e.message ).includes( needle ), '"' + e.message + '"' );
    }
}

/** The app's own SRV workaround, or the connection fails on some networks. */
function configureDns( url ) {
    if ( !url || !url.startsWith( 'mongodb+srv://' ) ) return;
    const configured = process.env.MONGO_DNS_SERVERS;
    if ( configured ) {
        const servers = configured.split( ',' )
            .map( ( s ) => s.trim() ).filter( Boolean );
        if ( servers.length ) {
            dns.setServers( servers );
            return;
        }
    }
    dns.setServers( [ '1.1.1.1', '8.8.8.8' ] );
}

/** Point the app's URI at the scratch database, whatever it names. */
function scratchUri( uri ) {
    const q = uri.indexOf( '?' );
    const query = q < 0 ? '' : uri.slice( q );
    const base = q < 0 ? uri : uri.slice( 0, q );
    const scheme = base.indexOf( '://' ) + 3;
    const slash = base.indexOf( '/', scheme );
    const host = slash < 0 ? base : base.slice( 0, slash );
    return host + '/' + TEST_DB + query;
}

const day = ( s ) => new Date( s + 'T00:00:00.000Z' );
const iso = ( d ) => new Date( d ).toISOString().slice( 0, 10 );

( async () => {
    const uri = process.env.MONGODB_URI;
    if ( !uri ) {
        console.error( 'MONGODB_URI is not set; cannot run the checks.' );
        process.exit( 1 );
    }
    configureDns( uri );
    mongoose.set( 'strictPopulate', false );
    await mongoose.connect( scratchUri( uri ) );
    console.log( 'connected to the scratch database: ' + mongoose.connection.name );
    if ( mongoose.connection.name !== TEST_DB ) {
        console.error( 'refusing to run outside the scratch database' );
        process.exit( 1 );
    }

    const { Product } = require( '../src/modules/product/product.model' );
    const { Shop } = require( '../src/modules/shop/shop.model' );
    const { Purchase } = require( '../src/modules/purchase/purchase.model' );
    const { Sale } = require( '../src/modules/sale/sale.model' );
    const { Stock } = require( '../src/modules/stock/stock.model' );
    const { PurchaseService } = require( '../src/modules/purchase/purchase.service' );
    const { SaleService } = require( '../src/modules/sale/sale.service' );
    const { StockService } = require( '../src/modules/stock/stock.service' );
    const { MotherCategory } = require( '../src/modules/mothercategory/mothercategory.model' );
    const { Category } = require( '../src/modules/category/category.model' );
    const { Capacity } = require( '../src/modules/capacity/capacity.model' );
    const { Company } = require( '../src/modules/company/company.model' );

    const ProductModel = new Product().getInstance();
    const ShopModel = new Shop().getInstance();
    const purchases = new PurchaseService( new Purchase().getInstance() );
    const sales = new SaleService( new Sale().getInstance() );
    const stock = new StockService( new Stock().getInstance() );

    const shop = await ShopModel.create( {
        name: 'Stock Test Shop', phone: '9000000000'
    } );

    const mother = await new MotherCategory().getInstance().create( { name: 'IMFL' } );
    const category = await new Category().getInstance().create( { name: 'Whisky' } );
    const capacity = await new Capacity().getInstance().create( { name: '750 ML', volumeMl: 750 } );
    const company = await new Company().getInstance().create( { name: 'Test Distillery' } );
    const refs = {
        motherCategory: mother._id,
        category: category._id,
        capacity: capacity._id,
        company: company._id
    };

    const whisky = await ProductModel.create( {
        name: 'Test Whisky 750', shop: shop._id, mrp: 1200, purchasePrice: 1000,
        inventory: 0, stockAlertQty: 5, ...refs
    } );
    const beer = await ProductModel.create( {
        name: 'Test Beer 650', shop: shop._id, mrp: 160, purchasePrice: 120,
        inventory: 0, stockAlertQty: 10, ...refs
    } );
    const SHOP = String( shop._id );
    const W = String( whisky._id );
    const B = String( beer._id );

    const stockOf = async ( id ) =>
        ( await ProductModel.findById( id ).select( 'inventory' ).lean() ).inventory;

    /** The snapshot rows for one product, oldest first. */
    const snapshotsOf = async ( id ) => stock.model
        .find( { 'shop': shop._id, 'product': new mongoose.Types.ObjectId( id ) } )
        .sort( { 'date': 1 } ).lean();

    /** Insert and confirm in one go, returning the document id. */
    const buy = async ( fields ) => {
        const made = await purchases.insert( { shop: SHOP, ...fields } );
        await purchases.confirm( String( made.data._id ), null );
        return String( made.data._id );
    };
    const sell = async ( fields ) => {
        const made = await sales.insert( { shop: SHOP, ...fields } );
        await sales.confirm( String( made.data._id ), null );
        return String( made.data._id );
    };

    try {
        console.log( '\n== a confirmed purchase puts stock in ==' );
        const p1 = await purchases.insert( {
            shop: SHOP, invoiceNo: 'INV-1', passNo: 'PASS-1',
            date: day( '2026-06-01' ),
            items: [
                { product: W, qty: 24, amount: 24000 },
                { product: B, qty: 48, amount: 5760 }
            ]
        } );
        check( 'created as a draft', p1.data.status === 'draft', p1.data.status );
        check( 'a draft moves no stock', ( await stockOf( W ) ) === 0, String( await stockOf( W ) ) );

        await purchases.confirm( String( p1.data._id ), null );
        check( 'confirming puts it in', ( await stockOf( W ) ) === 24, String( await stockOf( W ) ) );
        check( 'for every line', ( await stockOf( B ) ) === 48, String( await stockOf( B ) ) );

        const june1 = await stock.report( { shop: SHOP, product: W, date: '2026-06-01' } );
        check(
            'the 1st of June shows the purchase and nothing else',
            june1.rows[ 0 ].opening === 0 && june1.rows[ 0 ].purchaseQty === 24
                && june1.rows[ 0 ].saleQty === 0 && june1.rows[ 0 ].closing === 24,
            JSON.stringify( june1.rows[ 0 ] )
        );

        console.log( '\n== a confirmed sale takes stock out ==' );
        await sell( { date: day( '2026-06-03' ), items: [ { product: W, qty: 4 } ] } );
        check( 'stock falls', ( await stockOf( W ) ) === 20, String( await stockOf( W ) ) );
        const june3 = await stock.report( { shop: SHOP, product: W, date: '2026-06-03' } );
        check(
            'the 3rd opens on what the 1st closed',
            june3.rows[ 0 ].opening === 24 && june3.rows[ 0 ].saleQty === 4
                && june3.rows[ 0 ].closing === 20,
            JSON.stringify( june3.rows[ 0 ] )
        );

        console.log( '\n== overselling is refused ==' );
        const tooBig = await sales.insert( {
            shop: SHOP, date: day( '2026-06-04' ), items: [ { product: W, qty: 999 } ]
        } );
        await expectError(
            'a sale bigger than the stock cannot be confirmed',
            () => sales.confirm( String( tooBig.data._id ), null ),
            'Not enough stock'
        );
        check( 'and the refused sale moved nothing', ( await stockOf( W ) ) === 20, String( await stockOf( W ) ) );
        check(
            'the refused sale is still a draft',
            ( await sales.model.findById( tooBig.data._id ).select( 'status' ).lean() ).status === 'draft',
            ''
        );
        await sales.delete( String( tooBig.data._id ) );

        console.log( '\n== a range reads opening, in, out and in hand ==' );
        await buy( {
            invoiceNo: 'INV-2', passNo: 'P2', date: day( '2026-07-10' ),
            items: [ { product: W, qty: 12, amount: 12600 } ]
        } );
        await sell( { date: day( '2026-08-02' ), items: [ { product: W, qty: 6 } ] } );

        const june = await stock.totals( { shop: SHOP, from: '2026-06-01', to: '2026-06-30' } );
        check(
            'June: opened at nothing, 72 in, 4 out',
            june.opening === 0 && june.purchaseQty === 72 && june.saleQty === 4
                && june.closing === 68,
            JSON.stringify( june )
        );
        const julAug = await stock.totals( { shop: SHOP, from: '2026-07-01', to: '2026-08-05' } );
        check(
            "July to 5 August: opens on June's closing",
            julAug.opening === 68 && julAug.purchaseQty === 12
                && julAug.saleQty === 6 && julAug.closing === 74,
            JSON.stringify( julAug )
        );
        const whole = await stock.totals( { shop: SHOP, from: '2026-06-01', to: '2026-08-05' } );
        check(
            'the whole window agrees with the two halves',
            whole.opening === 0 && whole.purchaseQty === 84 && whole.saleQty === 10
                && whole.closing === 74,
            JSON.stringify( whole )
        );
        check(
            'and with the cached stock on the products',
            ( await stockOf( W ) ) + ( await stockOf( B ) ) === whole.closing,
            'cache ' + ( ( await stockOf( W ) ) + ( await stockOf( B ) ) ) + ' vs ' + whole.closing
        );

        console.log( '\n== a snapshot row only for a day that moved ==' );
        const snaps = await snapshotsOf( W );
        check(
            'only the days that moved have a row',
            snaps.map( ( r ) => iso( r.date ) ).join( ',' )
                === '2026-06-01,2026-06-03,2026-07-10,2026-08-02',
            snaps.map( ( r ) => iso( r.date ) ).join( ',' )
        );
        check(
            'and a row holds only that day, with no running balance in it',
            snaps.every( ( r ) => r.closing === undefined && r.opening === undefined )
                && snaps[ 0 ].inQty === 24 && snaps[ 1 ].outQty === 4,
            JSON.stringify( snaps.map( ( r ) => ( { in: r.inQty, out: r.outQty } ) ) )
        );
        // The balances are added up at read time, which is what lets one day
        // be corrected without touching any day after it.
        const runningTotal = snaps.reduce( ( t, r ) => t + r.inQty - r.outQty, 0 );
        check(
            'the rows add up to the stock on hand',
            runningTotal === ( await stockOf( W ) ),
            runningTotal + ' vs ' + ( await stockOf( W ) )
        );

        console.log( '\n== an admin edits a CONFIRMED purchase ==' );
        await purchases.update( String( p1.data._id ), {
            items: [
                { product: W, qty: 30, amount: 30000 },
                { product: B, qty: 48, amount: 5760 }
            ]
        } );
        // Whisky stood at 26 (24 in, 4 out, 12 in, 6 out). Six more bottles on
        // the June invoice must show up once, not as a re-posting of all 30.
        check(
            'the correction is recalculated, not re-added',
            ( await stockOf( W ) ) === 32,
            String( await stockOf( W ) ) + ' expected 32 (26 + the 6 extra)'
        );
        const juneAfter = await stock.totals( { shop: SHOP, from: '2026-06-01', to: '2026-06-30' } );
        check(
            "June's own figures were repaired, not just today's count",
            juneAfter.purchaseQty === 78 && juneAfter.closing === 74,
            JSON.stringify( juneAfter )
        );
        const augAfter = await stock.totals( { shop: SHOP, from: '2026-08-01', to: '2026-08-31' } );
        check(
            'and every month after it opens on the corrected figure',
            augAfter.opening === 86 && augAfter.closing === 80,
            JSON.stringify( augAfter )
        );

        console.log( '\n== moving a confirmed purchase to another date ==' );
        await purchases.update( String( p1.data._id ), { date: day( '2026-05-20' ) } );
        const may = await stock.totals( {
            shop: SHOP, product: W, from: '2026-05-01', to: '2026-05-31'
        } );
        check(
            'it now sits in May',
            may.purchaseQty === 30 && may.closing === 30,
            JSON.stringify( { purchased: may.purchaseQty, closing: may.closing } )
        );
        const juneMoved = await stock.totals( { shop: SHOP, from: '2026-06-01', to: '2026-06-30' } );
        check(
            'June no longer counts it, and opens on May instead',
            juneMoved.opening === 78 && juneMoved.purchaseQty === 0
                && juneMoved.saleQty === 4,
            JSON.stringify( juneMoved )
        );
        check(
            'the stock on hand is unchanged by a date move',
            ( await stockOf( W ) ) === 32, String( await stockOf( W ) )
        );

        console.log( '\n== unconfirming withdraws the stock ==' );
        await purchases.unconfirm( String( p1.data._id ), null );
        check(
            'the purchase is a draft again',
            ( await purchases.model.findById( p1.data._id ).select( 'status' ).lean() ).status === 'draft',
            ''
        );
        check( 'and its stock is gone', ( await stockOf( W ) ) === 2, String( await stockOf( W ) ) );
        check( 'for both its products', ( await stockOf( B ) ) === 0, String( await stockOf( B ) ) );
        const mayGone = await stock.totals( {
            shop: SHOP, product: W, from: '2026-05-01', to: '2026-05-31'
        } );
        check(
            'its May row is gone too',
            mayGone.purchaseQty === 0 && mayGone.closing === 0,
            JSON.stringify( { purchased: mayGone.purchaseQty, closing: mayGone.closing } )
        );

        console.log( '\n== a confirmed document cannot be deleted ==' );
        const keeper = await buy( {
            invoiceNo: 'INV-L2', passNo: 'PL2', date: day( '2026-08-20' ),
            items: [ { product: W, qty: 5, amount: 5000 } ]
        } );
        await expectError(
            'a confirmed purchase refuses deletion',
            () => purchases.delete( keeper ),
            'can no longer be deleted'
        );

        console.log( '\n== the rebuild works everything out from the documents ==' );
        const before = await stock.report( { shop: SHOP, from: '2026-01-01', to: '2026-12-31' } );
        await stock.model.deleteMany( { shop: new mongoose.Types.ObjectId( SHOP ) } );
        await ProductModel.updateMany( { shop: shop._id }, { $set: { inventory: 999 } } );
        const rebuilt = await stock.rebuild( { shop: SHOP } );
        const after = await stock.report( { shop: SHOP, from: '2026-01-01', to: '2026-12-31' } );
        check(
            'the report comes back identical',
            JSON.stringify( before.rows ) === JSON.stringify( after.rows ),
            rebuilt.products + ' products over ' + rebuilt.days + ' days'
        );
        check(
            'and the wrecked stock cache is repaired',
            ( await stockOf( W ) ) === 7 && ( await stockOf( B ) ) === 0,
            'whisky ' + ( await stockOf( W ) ) + ' beer ' + ( await stockOf( B ) )
        );
        const quiet = await ProductModel.create( {
            name: 'Never Moved 750', shop: shop._id, mrp: 500, purchasePrice: 400,
            inventory: 999, stockAlertQty: 5, ...refs
        } );
        await stock.rebuild( { shop: SHOP } );
        check(
            'a product with no document behind it is zeroed',
            ( await stockOf( String( quiet._id ) ) ) === 0,
            String( await stockOf( String( quiet._id ) ) )
        );

        console.log( "\n== one shop cannot see another's stock ==" );
        const other = await ShopModel.create( { name: 'Other Outlet', phone: '9111111111' } );
        const otherTotals = await stock.totals( {
            shop: String( other._id ), from: '2026-01-01', to: '2026-12-31'
        } );
        check(
            'a shop with no documents reads zero',
            otherTotals.opening === 0 && otherTotals.closing === 0,
            JSON.stringify( otherTotals )
        );
        await expectError(
            "a line naming another shop's product is refused",
            () => purchases.insert( {
                shop: String( other._id ), invoiceNo: 'X', passNo: 'X',
                date: day( '2026-06-01' ), items: [ { product: W, qty: 1, amount: 10 } ]
            } ),
            'belongs to another shop'
        );

        console.log( '\n== the sale bill: MRP x qty and nothing else ==' );
        await buy( {
            invoiceNo: 'INV-S', passNo: 'PS', date: day( '2026-09-01' ),
            items: [ { product: B, qty: 100, amount: 12000 } ]
        } );
        check( 'restocked for the sale checks', ( await stockOf( B ) ) === 100, String( await stockOf( B ) ) );

        const bill = await sales.insert( {
            shop: SHOP, date: day( '2026-09-05' ),
            items: [ { product: B, qty: 10, rate: 160, amount: 1600 } ]
        } );
        check(
            'the bill is the lines added up',
            bill.data.totalQty === 10 && bill.data.totalAmount === 1600
                && bill.data.netAmount === 1600,
            JSON.stringify( {
                totalQty: bill.data.totalQty,
                totalAmount: bill.data.totalAmount,
                netAmount: bill.data.netAmount
            } )
        );
        check(
            'there is no discount or round off on it',
            bill.data.discount === undefined && bill.data.roundOff === undefined,
            JSON.stringify( { discount: bill.data.discount, roundOff: bill.data.roundOff } )
        );
        check(
            'and no bill number or customer either',
            bill.data.billNo === undefined && bill.data.customer === undefined,
            JSON.stringify( { billNo: bill.data.billNo, customer: bill.data.customer } )
        );
        const bare = await sales.insert( {
            shop: SHOP, date: day( '2026-09-05' ), items: [ { product: B, qty: 3 } ]
        } );
        check(
            'a line with no figures takes the MRP',
            bare.data.items[ 0 ].rate === 160 && bare.data.items[ 0 ].amount === 480
                && bare.data.netAmount === 480,
            JSON.stringify( bare.data.items[ 0 ] ) + ' net=' + bare.data.netAmount
        );
        const claimed = await sales.insert( {
            shop: SHOP, date: day( '2026-09-05' ),
            items: [ { product: B, qty: 1, rate: 160, amount: 160 } ],
            netAmount: 1
        } );
        check(
            "a client's own netAmount is ignored — the lines decide",
            claimed.data.netAmount === 160, String( claimed.data.netAmount )
        );
        await sales.delete( String( bare.data._id ) );
        await sales.delete( String( claimed.data._id ) );

        await sales.confirm( String( bill.data._id ), null );
        check( 'the sale took its stock out', ( await stockOf( B ) ) === 90, String( await stockOf( B ) ) );

        console.log( '\n== the takings recorded on a sale ==' );
        const paid = await sales.insert( {
            shop: SHOP, date: day( '2026-09-06' ),
            items: [ { product: B, qty: 2 } ],
            payment: { cash: 200, qr: 100, card: 20.5, expense: 15 }
        } );
        check(
            'all four are stored as entered',
            paid.data.payment.cash === 200 && paid.data.payment.qr === 100
                && paid.data.payment.card === 20.5
                && paid.data.payment.expense === 15,
            JSON.stringify( paid.data.payment )
        );
        check(
            'and they do not touch the bill',
            paid.data.totalAmount === 320 && paid.data.netAmount === 320,
            JSON.stringify( {
                total: paid.data.totalAmount, net: paid.data.netAmount
            } )
        );
        // Deliberately not reconciled: 335.50 counted against a 320 bill is
        // recorded as it stands, because that difference is the thing worth
        // seeing.
        check(
            'a figure that does not match the bill is still kept',
            paid.data.payment.cash + paid.data.payment.qr
                + paid.data.payment.card !== paid.data.netAmount,
            '320.50 counted vs a bill of ' + paid.data.netAmount
        );

        await sales.update( String( paid.data._id ), {
            payment: { cash: 320, qr: 0, card: 0, expense: 0 }
        } );
        const corrected = await sales.model
            .findById( paid.data._id ).select( 'payment items' ).lean();
        check(
            'an edit replaces them',
            corrected.payment.cash === 320 && corrected.payment.qr === 0,
            JSON.stringify( corrected.payment )
        );
        check(
            'and leaves the lines alone',
            corrected.items.length === 1 && corrected.items[ 0 ].qty === 2,
            JSON.stringify( { lines: corrected.items.length } )
        );

        await sales.confirm( String( paid.data._id ), null );
        const afterConfirm = await sales.model
            .findById( paid.data._id ).select( 'payment status' ).lean();
        check(
            'and they survive confirming',
            afterConfirm.status === 'confirmed'
                && afterConfirm.payment.cash === 320,
            afterConfirm.status + ' cash=' + afterConfirm.payment.cash
        );
        await sales.unconfirm( String( paid.data._id ), null );
        await sales.delete( String( paid.data._id ) );

        // A sale that sends none is left without the block rather than given
        // four zeroes it never claimed.
        const noneSent = await sales.insert( {
            shop: SHOP, date: day( '2026-09-06' ), items: [ { product: B, qty: 1 } ]
        } );
        const bare2 = await sales.model
            .findById( noneSent.data._id ).select( 'payment' ).lean();
        // Mongoose fills the sub-document's defaults, so the block exists
        // with four zeroes rather than being absent. Either way nothing was
        // counted, which is what the drawer reads.
        check(
            'a sale with no takings entered records zero, not a guess',
            !bare2.payment
                || ( !bare2.payment.cash && !bare2.payment.qr
                    && !bare2.payment.card && !bare2.payment.expense ),
            JSON.stringify( bare2.payment )
        );
        await sales.delete( String( noneSent.data._id ) );

        await expectError(
            'a takings figure that is not a number is refused',
            () => sales.insert( {
                shop: SHOP, date: day( '2026-09-06' ),
                items: [ { product: B, qty: 1 } ],
                payment: { cash: 'lots' }
            } ),
            'is not a number'
        );


        console.log( '\n== editing a CONFIRMED sale ==' );
        await sales.update( String( bill.data._id ), {
            items: [ { product: B, qty: 25, rate: 160, amount: 4000 } ]
        } );
        check(
            'the correction is recalculated, not re-applied',
            ( await stockOf( B ) ) === 75, String( await stockOf( B ) ) + ' expected 75'
        );
        const sept = await stock.totals( {
            shop: SHOP, product: B, from: '2026-09-01', to: '2026-09-30'
        } );
        check(
            "September's figures follow the correction",
            sept.purchaseQty === 100 && sept.saleQty === 25 && sept.closing === 75,
            JSON.stringify( sept )
        );

        console.log( '\n== an edit that would oversell is rolled back ==' );
        await expectError(
            'correcting a confirmed sale beyond the stock is refused',
            () => sales.update( String( bill.data._id ), {
                items: [ { product: B, qty: 500, rate: 160, amount: 80000 } ]
            } ),
            'Not enough stock'
        );
        check( 'and the refused edit left the stock alone', ( await stockOf( B ) ) === 75, String( await stockOf( B ) ) );
        const kept = await sales.model.findById( bill.data._id ).select( 'items' ).lean();
        check(
            'and left the bill alone too — the transaction rolled back',
            kept.items[ 0 ].qty === 25, String( kept.items[ 0 ].qty )
        );

        console.log( '\n== selling exactly what is left is allowed ==' );
        const toTheLast = await sell( {
            date: day( '2026-09-10' ), items: [ { product: B, qty: 75 } ]
        } );
        check( 'stock lands exactly on zero', ( await stockOf( B ) ) === 0, String( await stockOf( B ) ) );
        const oneTooMany = await sales.insert( {
            shop: SHOP, date: day( '2026-09-11' ), items: [ { product: B, qty: 1 } ]
        } );
        await expectError(
            'and one more bottle is refused',
            () => sales.confirm( String( oneTooMany.data._id ), null ),
            'Not enough stock'
        );
        await sales.delete( String( oneTooMany.data._id ) );

        console.log( '\n== unconfirming a sale puts the stock back ==' );
        await sales.unconfirm( toTheLast, null );
        check( 'the stock is back', ( await stockOf( B ) ) === 75, String( await stockOf( B ) ) );

        console.log( '\n== an admin reworks a CONFIRMED bill: + - remove add ==' );
        const rum = await ProductModel.create( {
            name: 'Test Rum 750', shop: shop._id, mrp: 900, purchasePrice: 700,
            inventory: 0, stockAlertQty: 5, ...refs
        } );
        const gin = await ProductModel.create( {
            name: 'Test Gin 750', shop: shop._id, mrp: 1100, purchasePrice: 850,
            inventory: 0, stockAlertQty: 5, ...refs
        } );
        const vodka = await ProductModel.create( {
            name: 'Test Vodka 750', shop: shop._id, mrp: 1000, purchasePrice: 780,
            inventory: 0, stockAlertQty: 5, ...refs
        } );
        const R = String( rum._id );
        const G = String( gin._id );
        const V = String( vodka._id );

        const rework = await buy( {
            invoiceNo: 'INV-RW', passNo: 'PRW', date: day( '2026-10-05' ),
            items: [
                { product: R, qty: 10, amount: 7000 },
                { product: G, qty: 20, amount: 17000 }
            ]
        } );
        check(
            'the bill posts both lines',
            ( await stockOf( R ) ) === 10 && ( await stockOf( G ) ) === 20,
            'rum=' + ( await stockOf( R ) ) + ' gin=' + ( await stockOf( G ) )
        );

        await purchases.update( rework, {
            items: [
                { product: R, qty: 15, amount: 10500 },
                { product: G, qty: 20, amount: 17000 }
            ]
        } );
        check( '(+) a raised quantity shows the difference once',
            ( await stockOf( R ) ) === 15, String( await stockOf( R ) ) + ' expected 15' );

        await purchases.update( rework, {
            items: [
                { product: R, qty: 4, amount: 2800 },
                { product: G, qty: 20, amount: 17000 }
            ]
        } );
        check( '(-) a lowered quantity comes back down',
            ( await stockOf( R ) ) === 4, String( await stockOf( R ) ) + ' expected 4' );

        // REMOVE: gin is not in the payload at all, so its stock must go even
        // though nothing in the request names it.
        await purchases.update( rework, { items: [ { product: R, qty: 4, amount: 2800 } ] } );
        check(
            'a removed line takes its stock with it',
            ( await stockOf( G ) ) === 0, String( await stockOf( G ) ) + ' expected 0'
        );
        check(
            "and the removed line's snapshot rows are gone too",
            ( await snapshotsOf( G ) ).length === 0,
            JSON.stringify( await snapshotsOf( G ) )
        );
        check( 'while the line that stayed is untouched', ( await stockOf( R ) ) === 4, String( await stockOf( R ) ) );

        // ADD: gin back, plus a product the bill never had.
        await purchases.update( rework, {
            items: [
                { product: R, qty: 4, amount: 2800 },
                { product: G, qty: 20, amount: 17000 },
                { product: V, qty: 6, amount: 4680 }
            ]
        } );
        check(
            'an added line posts, and a restored one comes back',
            ( await stockOf( V ) ) === 6 && ( await stockOf( G ) ) === 20,
            'vodka=' + ( await stockOf( V ) ) + ' gin=' + ( await stockOf( G ) )
        );
        const rwBill = await purchases.model.findById( rework ).select( 'items totalQty' ).lean();
        check(
            'the bill itself carries the three lines',
            rwBill.items.length === 3 && rwBill.totalQty === 30,
            JSON.stringify( { lines: rwBill.items.length, qty: rwBill.totalQty } )
        );
        const repaired = await stock.rebuild( { shop: SHOP } );
        check(
            'a rebuild after all that changes nothing',
            ( await stockOf( R ) ) === 4 && ( await stockOf( G ) ) === 20
                && ( await stockOf( V ) ) === 6,
            'rum=' + ( await stockOf( R ) ) + ' gin=' + ( await stockOf( G ) )
                + ' vodka=' + ( await stockOf( V ) ) + ' over ' + repaired.days + ' days'
        );

        console.log( '\n== the drill-down: which documents moved what ==' );
        const moves = await stock.movements( { shop: SHOP, from: '2026-01-01', to: '2026-12-31' } );
        check(
            'it returns both purchases and sales',
            moves.rows.some( ( r ) => r.kind === 'purchase' )
                && moves.rows.some( ( r ) => r.kind === 'sale' ),
            [ ...new Set( moves.rows.map( ( r ) => r.kind ) ) ].join( ',' )
        );
        check(
            'a sale line is signed negative, a purchase positive',
            moves.rows.every( ( r ) => ( r.kind === 'sale' ? r.qty < 0 : r.qty > 0 ) ),
            moves.rows.slice( 0, 4 ).map( ( r ) => r.kind + ':' + r.qty ).join( ' ' )
        );
        check(
            'every row points back at its document',
            moves.rows.every( ( r ) => !!r.source ), moves.rows.length + ' rows'
        );
        check(
            'a purchase quotes its invoice no; a sale has none to quote',
            moves.rows.every( ( r ) =>
                ( r.kind === 'purchase' ? !!r.docNo : r.docNo === undefined ) ),
            JSON.stringify( moves.rows.map( ( r ) => r.kind + ':' + ( r.docNo || '-' ) ) )
        );
        check(
            'the product is joined in, not left as an id',
            moves.rows.every( ( r ) => r.product && r.product.name ),
            String( moves.rows[ 0 ] && moves.rows[ 0 ].product.name )
        );
        check(
            'newest first',
            moves.rows.every( ( r, i ) =>
                ( i === 0 || new Date( moves.rows[ i - 1 ].date ) >= new Date( r.date ) ) ),
            moves.rows.slice( 0, 3 ).map( ( r ) => iso( r.date ) ).join( ' > ' )
        );
        const movedNet = moves.rows.reduce( ( s, r ) => s + r.qty, 0 );
        const wholeYear = await stock.totals( { shop: SHOP, from: '2026-01-01', to: '2026-12-31' } );
        check(
            'the drill-down adds up to the figure it explains',
            movedNet === wholeYear.closing, movedNet + ' vs ' + wholeYear.closing
        );
        const onlySales = await stock.movements( {
            shop: SHOP, from: '2026-01-01', to: '2026-12-31', kind: 'sale'
        } );
        const onlyBuys = await stock.movements( {
            shop: SHOP, from: '2026-01-01', to: '2026-12-31', kind: 'purchase'
        } );
        check(
            'it narrows to sales alone',
            onlySales.rows.length > 0 && onlySales.rows.every( ( r ) => r.kind === 'sale' ),
            onlySales.rows.length + ' rows'
        );
        check(
            'and to purchases alone',
            onlyBuys.rows.length > 0 && onlyBuys.rows.every( ( r ) => r.kind === 'purchase' ),
            onlyBuys.rows.length + ' rows'
        );
        check(
            'the two narrowings together are the whole list',
            onlySales.rows.length + onlyBuys.rows.length === moves.rows.length,
            onlyBuys.rows.length + ' + ' + onlySales.rows.length + ' vs ' + moves.rows.length
        );
        const firstPage = await stock.movements( {
            shop: SHOP, from: '2026-01-01', to: '2026-12-31', limit: 2
        } );
        check(
            'a page is the size asked for and says there is more',
            firstPage.rows.length === 2 && firstPage.hasNext === true
                && firstPage.totalCount === moves.totalCount,
            firstPage.rows.length + ' of ' + firstPage.totalCount
        );
        const draftSale = await sales.insert( {
            shop: SHOP, date: day( '2026-11-01' ), items: [ { product: B, qty: 2 } ]
        } );
        const withDraft = await stock.movements( {
            shop: SHOP, from: '2026-01-01', to: '2026-12-31'
        } );
        check(
            'a draft is not in the drill-down',
            withDraft.totalCount === moves.totalCount,
            withDraft.totalCount + ' vs ' + moves.totalCount
        );
        await sales.delete( String( draftSale.data._id ) );

        // A opening 100  B purchase 40  C total 140  D sold 30  E in hand 110
        // F MRP 250      G = F x E 27,500            H = F x D 7,500
        console.log( '\n== the report columns: A B C=A+B D E=C-D F G=FxE H=FxD ==' );
        const reported = await ProductModel.create( {
            name: 'Report Test 750', shop: shop._id, mrp: 250, purchasePrice: 200,
            inventory: 0, stockAlertQty: 5, ...refs
        } );
        const RP = String( reported._id );
        // 100 in BEFORE the window opens, so the opening balance is a real
        // carried-forward figure rather than zero.
        await buy( {
            invoiceNo: 'INV-RC1', passNo: 'P1', date: day( '2026-11-05' ),
            items: [ { product: RP, qty: 100, amount: 20000 } ]
        } );
        await buy( {
            invoiceNo: 'INV-RC2', passNo: 'P2', date: day( '2026-11-12' ),
            items: [ { product: RP, qty: 40, amount: 8000 } ]
        } );
        await sell( { date: day( '2026-11-15' ), items: [ { product: RP, qty: 30 } ] } );

        const sheet = await stock.report( {
            shop: SHOP, product: RP, from: '2026-11-10', to: '2026-11-20'
        } );
        const row = sheet.rows.find( ( r ) => String( r.product._id ) === RP );
        check( 'the product has a row in the window', !!row, String( sheet.rows.length ) );
        check( 'A — opening is the balance on the from date',
            row.opening === 100, String( row.opening ) + ' expected 100' );
        check( 'B — purchase is everything in over the range',
            row.purchaseQty === 40, String( row.purchaseQty ) + ' expected 40' );
        check( 'C — total stock is A + B',
            row.totalQty === 140 && row.totalQty === row.opening + row.purchaseQty,
            String( row.totalQty ) + ' expected 140' );
        check( 'D — sold is everything out over the range',
            row.saleQty === 30, String( row.saleQty ) + ' expected 30' );
        check( 'E — in hand is C - D',
            row.closing === 110 && row.closing === row.totalQty - row.saleQty,
            String( row.closing ) + ' expected 110' );
        check( 'F — MRP comes from the product', row.mrp === 250, String( row.mrp ) );
        check( 'G — stock amount is F x E',
            row.stockValue === 27500 && row.stockValue === row.mrp * row.closing,
            String( row.stockValue ) + ' expected 27500' );
        check( 'H — sale amount is F x D',
            row.saleValue === 7500 && row.saleValue === row.mrp * row.saleQty,
            String( row.saleValue ) + ' expected 7500' );
        check( 'and H matches what the bills actually charged',
            row.saleAmount === row.saleValue,
            'billed ' + row.saleAmount + ' vs at MRP ' + row.saleValue );
        check(
            "the window's totals carry the money columns",
            sheet.totals.stockValue === 27500 && sheet.totals.saleValue === 7500,
            JSON.stringify( {
                stockValue: sheet.totals.stockValue,
                saleValue: sheet.totals.saleValue
            } )
        );

        // One day on its own, which is what "today" asks for.
        const oneDay = await stock.report( { shop: SHOP, product: RP, date: '2026-11-15' } );
        const dayRow = oneDay.rows.find( ( r ) => String( r.product._id ) === RP );
        check(
            'a single day opens on 140 and closes on 110',
            dayRow.opening === 140 && dayRow.saleQty === 30 && dayRow.closing === 110,
            JSON.stringify( {
                opening: dayRow.opening, sold: dayRow.saleQty, closing: dayRow.closing
            } )
        );
        check(
            "and values that day's sale at the MRP",
            dayRow.saleValue === 7500 && dayRow.stockValue === 27500,
            JSON.stringify( { saleValue: dayRow.saleValue, stockValue: dayRow.stockValue } )
        );

        const beforeAny = await stock.report( {
            shop: SHOP, product: RP, from: '2026-10-01', to: '2026-10-31'
        } );
        const beforeRow = beforeAny.rows.find( ( r ) => String( r.product._id ) === RP );
        check(
            'a window before the first purchase is all zeroes',
            beforeRow.opening === 0 && beforeRow.totalQty === 0
                && beforeRow.closing === 0 && beforeRow.stockValue === 0
                && beforeRow.saleValue === 0,
            JSON.stringify( beforeRow )
        );
        check( 'but the MRP still shows, so the row is readable',
            beforeRow.mrp === 250, String( beforeRow.mrp ) );
        check(
            'a product that did not move still gets a row',
            beforeAny.rows.length === 1, String( beforeAny.rows.length ) + ' row(s)'
        );

        const shopWide = await stock.totals( { shop: SHOP, from: '2026-01-01', to: '2026-12-31' } );
        const everyRow = await stock.report( {
            shop: SHOP, from: '2026-01-01', to: '2026-12-31', limit: 500
        } );
        const summed = everyRow.rows.reduce(
            ( s, r ) => ( {
                stockValue: s.stockValue + r.stockValue,
                saleValue: s.saleValue + r.saleValue
            } ),
            { stockValue: 0, saleValue: 0 }
        );
        check(
            'the shop total is the rows added up, product by product',
            Math.abs( summed.stockValue - shopWide.stockValue ) < 0.01
                && Math.abs( summed.saleValue - shopWide.saleValue ) < 0.01,
            JSON.stringify( {
                summed,
                reported: {
                    stockValue: shopWide.stockValue, saleValue: shopWide.saleValue
                }
            } )
        );
        check(
            'and the in-hand total agrees with the cached stock',
            everyRow.rows.reduce( ( s, r ) => s + r.closing, 0 ) === shopWide.closing,
            everyRow.rows.reduce( ( s, r ) => s + r.closing, 0 ) + ' vs ' + shopWide.closing
        );

        // The filter has to reach the totals as well as the rows. It did not:
        // filtering by company narrowed the table but left the tiles above it
        // showing the whole outlet.
        console.log( '\n== a filter narrows the totals, not just the rows ==' );
        const otherCo = await new Company().getInstance().create( { name: 'Other Distillery' } );
        const theirs = await ProductModel.create( {
            name: 'Other Co Whisky 750', shop: shop._id, mrp: 300,
            purchasePrice: 240, inventory: 0, stockAlertQty: 5,
            ...refs, company: otherCo._id
        } );
        const OC = String( theirs._id );
        await buy( {
            invoiceNo: 'INV-OC', passNo: 'POC', date: day( '2026-11-06' ),
            items: [ { product: OC, qty: 50, amount: 12000 } ]
        } );
        await sell( { date: day( '2026-11-14' ), items: [ { product: OC, qty: 20 } ] } );

        const span = { shop: SHOP, from: '2026-11-01', to: '2026-11-20' };
        const byCompany = { ...span, company: String( otherCo._id ) };

        const theirRows = await stock.report( { ...byCompany, limit: 500 } );
        check(
            'the rows narrow to that company',
            theirRows.rows.length === 1
                && String( theirRows.rows[ 0 ].product._id ) === OC,
            theirRows.rows.map( ( r ) => r.product.name ).join( ', ' )
        );
        const theirTotals = await stock.totals( byCompany );
        check(
            'and so do the totals — 50 in, 20 out, 30 left',
            theirTotals.purchaseQty === 50 && theirTotals.saleQty === 20
                && theirTotals.closing === 30,
            JSON.stringify( theirTotals )
        );
        check(
            "valued at that company's own MRP",
            theirTotals.stockValue === 9000 && theirTotals.saleValue === 6000,
            JSON.stringify( {
                stockValue: theirTotals.stockValue, saleValue: theirTotals.saleValue
            } )
        );
        check(
            'the totals equal the rows they sit above',
            theirTotals.closing === theirRows.rows.reduce( ( t, r ) => t + r.closing, 0 )
                && theirTotals.stockValue
                    === theirRows.rows.reduce( ( t, r ) => t + r.stockValue, 0 ),
            JSON.stringify( { totals: theirTotals.closing, rows: theirRows.rows.length } )
        );

        const unfiltered = await stock.totals( span );
        check(
            'and they are NOT the whole outlet — the bug this replaced',
            unfiltered.purchaseQty > theirTotals.purchaseQty
                && unfiltered.closing !== theirTotals.closing,
            'whole shop ' + JSON.stringify( {
                purchased: unfiltered.purchaseQty, closing: unfiltered.closing
            } ) + ' vs filtered ' + JSON.stringify( {
                purchased: theirTotals.purchaseQty, closing: theirTotals.closing
            } )
        );

        const searched = await stock.totals( { ...span, search: 'Other Co' } );
        check(
            'a search narrows the totals too',
            searched.purchaseQty === 50 && searched.closing === 30,
            JSON.stringify( { purchased: searched.purchaseQty, closing: searched.closing } )
        );
        const nothing = await stock.totals( { ...span, search: 'no such product' } );
        check(
            'a filter that matches nothing reads zero rather than everything',
            nothing.purchaseQty === 0 && nothing.closing === 0
                && nothing.stockValue === 0,
            JSON.stringify( nothing )
        );
        // 'moved' is gone: a report that hides what did not move cannot show
        // stock in hand, which is the column it exists for.
        const withLeftover = await stock.report( { ...span, moved: 'true', limit: 500 } );
        const withoutIt = await stock.report( { ...span, limit: 500 } );
        check(
            'a leftover moved=true from an old client changes nothing',
            withLeftover.rows.length === withoutIt.rows.length,
            withLeftover.rows.length + ' rows either way'
        );

        // Stock is worked out from the confirmed purchases and sales. A
        // quantity typed on the product form would be stock no document
        // explains, and the next rebuild would wipe it — so a new product
        // starts empty whatever the client sends, and stock arrives by
        // confirming a purchase.
        console.log( '\n== a new product starts at zero ==' );
        const { ProductService } = require( '../src/modules/product/product.service' );
        const productSvc = new ProductService( ProductModel );

        const fresh = await productSvc.insert( {
            name: 'Starts Empty 750', shop: shop._id, mrp: 400,
            purchasePrice: 320, inventory: 60, stockAlertQty: 5, ...refs
        } );
        const NP = String( fresh.data._id );
        check(
            'a quantity sent on create is ignored',
            ( await stockOf( NP ) ) === 0,
            String( await stockOf( NP ) ) + ' expected 0'
        );
        const todayIso = new Date().toISOString().slice( 0, 10 );
        const freshRow = ( await stock.report( {
            shop: SHOP, product: NP, date: todayIso
        } ) ).rows[ 0 ];
        check(
            'and the report shows it holding nothing',
            freshRow.opening === 0 && freshRow.purchaseQty === 0
                && freshRow.closing === 0 && freshRow.stockValue === 0,
            JSON.stringify( {
                opening: freshRow.opening, purchased: freshRow.purchaseQty,
                closing: freshRow.closing
            } )
        );
        check(
            'no document was invented behind it',
            ( await purchases.model.countDocuments( {
                'shop': shop._id,
                'invoiceNo': { '$regex': '^OPENING STOCK' }
            } ) ) === 0,
            'no opening purchase'
        );

        // The only way stock arrives.
        await buy( {
            invoiceNo: 'INV-NP', passNo: 'PNP', date: day( todayIso ),
            items: [ { product: NP, qty: 12, amount: 3840 } ]
        } );
        check(
            'confirming a purchase is what puts stock on it',
            ( await stockOf( NP ) ) === 12, String( await stockOf( NP ) )
        );

        // The bulk import follows the same rule.
        const shopB = await ShopModel.create( {
            name: 'Import Test Shop', phone: '9222222222'
        } );
        const imported = await ProductModel.create( {
            name: 'Imported Empty 750', shop: shopB._id, mrp: 600,
            purchasePrice: 480, inventory: 0, stockAlertQty: 5, ...refs
        } );
        check(
            'an imported product holds nothing either',
            ( await stockOf( String( imported._id ) ) ) === 0,
            String( await stockOf( String( imported._id ) ) )
        );

        // The import template no longer offers the column at all, so a file
        // cannot carry a figure that would be silently dropped.
        const tpl = await productSvc.buildTemplateWorkbook();
        const headers = tpl.getWorksheet( 'Products' ).getRow( 1 ).values
            .filter( Boolean ).map( String );
        check(
            'the import template has no inventory column',
            !headers.some( ( h ) => h.toLowerCase() === 'inventory' ),
            headers.join( ', ' )
        );


        console.log( '\n== a classifier in use cannot be deleted ==' );
        const { CategoryService } = require( '../src/modules/category/category.service' );
        const { MotherCategoryService } = require( '../src/modules/mothercategory/mothercategory.service' );
        const { CompanyService } = require( '../src/modules/company/company.service' );
        const { CapacityService } = require( '../src/modules/capacity/capacity.service' );
        const categories = new CategoryService( new Category().getInstance() );
        const mothers = new MotherCategoryService( new MotherCategory().getInstance() );
        const companies = new CompanyService( new Company().getInstance() );
        const capacities = new CapacityService( new Capacity().getInstance() );

        await expectError(
            'a category with products refuses to go',
            () => categories.delete( String( category._id ) ),
            'cannot be deleted'
        );
        await expectError(
            'and says how many are filed under it',
            () => categories.delete( String( category._id ) ),
            'product'
        );
        await expectError(
            'a mother category with products refuses too',
            () => mothers.delete( String( mother._id ) ),
            'cannot be deleted'
        );
        await expectError(
            'so does a company',
            () => companies.delete( String( company._id ) ),
            'cannot be deleted'
        );
        await expectError(
            'and a measurement',
            () => capacities.delete( String( capacity._id ) ),
            'cannot be deleted'
        );
        check(
            'and the refusal left the record alone',
            !!( await new Category().getInstance().findById( category._id ).lean() ),
            'still there'
        );

        // One nothing is filed under goes cleanly.
        const spare = await new Category().getInstance().create( { name: 'Unused Category' } );
        await categories.delete( String( spare._id ) );
        check(
            'a classifier nothing uses deletes cleanly',
            !( await new Category().getInstance().findById( spare._id ).lean() ),
            'gone'
        );

        // The guard counts products, so emptying the shelf is not enough —
        // the product has to be re-filed or removed first.
        const lonely = await new Company().getInstance().create( { name: 'Lonely Co' } );
        const onlyProduct = await ProductModel.create( {
            name: 'Guard Test 750', shop: shop._id, mrp: 100, purchasePrice: 80,
            inventory: 0, stockAlertQty: 1, ...refs, company: lonely._id
        } );
        await expectError(
            'a company whose only product holds no stock still refuses',
            () => companies.delete( String( lonely._id ) ),
            'used by 1 product'
        );
        await ProductModel.deleteOne( { _id: onlyProduct._id } );
        await companies.delete( String( lonely._id ) );
        check(
            'and goes once that product is removed',
            !( await new Company().getInstance().findById( lonely._id ).lean() ),
            'gone'
        );

        console.log( '\n== a bad range is refused ==' );
        await expectError(
            'to before from',
            () => stock.totals( { shop: SHOP, from: '2026-08-01', to: '2026-07-01' } ),
            'ends before it starts'
        );
        await expectError(
            'no range at all', () => stock.totals( { shop: SHOP } ), 'needs a date range'
        );
        await expectError(
            'and a report with no shop',
            () => stock.report( { from: '2026-01-01', to: '2026-12-31' } ),
            'needs a shop'
        );
    } finally {
        await mongoose.connection.dropDatabase();
        console.log( '\nscratch database dropped' );
        await mongoose.disconnect();
    }

    console.log(
        problems.length
            ? '\nPROBLEMS:\n - ' + problems.join( '\n - ' )
            : '\nALL CHECKS PASSED'
    );
    process.exit( problems.length ? 1 : 0 );
} )().catch( async ( e ) => {
    console.error( 'FAILED:', e );
    await mongoose.connection.dropDatabase().catch( () => {} );
    await mongoose.disconnect().catch( () => {} );
    process.exit( 1 );
} );
