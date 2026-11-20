'use strict';
const path = require( 'path' );
const mongoose = require( 'mongoose' );
const ExcelJS = require( 'exceljs' );
const PDFDocument = require( 'pdfkit' );

// Bundled Unicode fonts for the price-list PDF. PDFKit's built-in Helvetica
// cannot render the rupee sign (₹) or many symbols, so we embed Noto Sans
// (which includes ₹ and ®) and use it for the whole document.
const FONT_REGULAR = path.join( __dirname, '..', '..', 'assets', 'fonts', 'NotoSans-Regular.ttf' );
const FONT_BOLD = path.join( __dirname, '..', '..', 'assets', 'fonts', 'NotoSans-Bold.ttf' );
const { CalmService } = require( '../../../system/core/CalmService' );

// Keep these in step with the enums on the product model.
const MAIN_UNITS = [ 'BOTTLE' ];
const ALTERNATE_UNITS = [ 'CASE' ];
// Column order of the bulk-import template.
const TEMPLATE_COLUMNS = [
    { 'header': 'shop', 'key': 'shop', 'width': 22 },
    { 'header': 'name', 'key': 'name', 'width': 36 },
    { 'header': 'category', 'key': 'category', 'width': 22 },
    { 'header': 'company', 'key': 'company', 'width': 22 },
    { 'header': 'motherCategory', 'key': 'motherCategory', 'width': 22 },
    { 'header': 'capacity', 'key': 'capacity', 'width': 14 },
    { 'header': 'mrp', 'key': 'mrp', 'width': 12 },
    { 'header': 'purchasePrice', 'key': 'purchasePrice', 'width': 16 },
    { 'header': 'mainUnit', 'key': 'mainUnit', 'width': 12 },
    { 'header': 'alternateUnit', 'key': 'alternateUnit', 'width': 14 },
    { 'header': 'perAlternateUnitQty', 'key': 'perAlternateUnitQty', 'width': 20 },
    { 'header': 'stockAlertQty', 'key': 'stockAlertQty', 'width': 14 },
    { 'header': 'inventory', 'key': 'inventory', 'width': 12 },
    { 'header': 'status', 'key': 'status', 'width': 10 }
];
// Accepted spellings for the boolean `status` column, plus the dropdown values.
const STATUS_VALUES = [ 'YES', 'NO' ];
const STATUS_TRUE = [ 'YES', 'Y', 'TRUE', '1', 'ACTIVE' ];
const STATUS_FALSE = [ 'NO', 'N', 'FALSE', '0', 'INACTIVE' ];
// Export layout: the template columns prefixed with the product's _id. The _id
// drives the price-update upload (rows are matched back to products by it).
const EXPORT_COLUMNS = [
    { 'header': '_id', 'key': '_id', 'width': 26 },
    ...TEMPLATE_COLUMNS
];

/** Normalise an ExcelJS cell value (plain, rich-text, formula, hyperlink). */
function cellText( value ) {
    if ( value === null || value === undefined ) return '';
    if ( typeof value === 'object' ) {
        if ( Array.isArray( value.richText ) ) {
            return value.richText.map( ( t ) => t.text ).join( '' );
        }
        if ( 'text' in value ) return value.text;
        if ( 'result' in value ) return value.result;
        if ( 'hyperlink' in value ) return value.text || value.hyperlink;
    }
    return value;
}

class ProductService extends CalmService {
    // Setting Global Populate to apply in Get All & Get Single
    populateFields = [
        { path: 'shop', select: 'name phone status displayNumber' },
        { path: 'category', select: 'name status displayNumber' },
        { path: 'motherCategory', select: 'name status displayNumber' },
        { path: 'company', select: 'name status displayNumber' },
        { path: 'capacity', select: 'name volumeMl status displayNumber' }
    ];
    // Fields matched by the `search` query param
    searchFields = [ 'name' ];
    constructor( model ) {
        super( model );
    }

    /**
     * Convert a sortBy value (Mongo object, or a space-separated string like
     * '-mrp name') into an aggregation $sort object.
     */
    buildSort( sortBy ) {
        if ( sortBy && typeof sortBy === 'object' ) {
            return sortBy;
        }
        if ( typeof sortBy === 'string' && sortBy.trim() ) {
            const sort = {};
            sortBy.trim().split( /\s+/ ).forEach( ( token ) => {
                if ( token.startsWith( '-' ) ) {
                    sort[ token.slice( 1 ) ] = -1;
                } else {
                    sort[ token ] = 1;
                }
            } );
            return sort;
        }
        // Default: category position first, then the product's own position.
        return { 'categoryDoc.displayNumber': 1, 'displayNumber': 1, 'createdAt': 1 };
    }

    /**
     * List products. By default they are ordered first by their category's
     * displayNumber, then by the product's own displayNumber. A $lookup is used
     * because the category order lives on the referenced category document.
     */
    async getAll( query, ops = {} ) {
        // eslint-disable-next-line prefer-const
        let { skip, limit, sortBy, search, ...restQuery } = query;
        skip = skip ? Number( skip ) : 0;
        limit = limit ? Number( limit ) : 100;

        const searchFields = Array.isArray( ops.searchFields ) ? ops.searchFields : this.searchFields;

        // Build the $match stage (aggregation does not auto-cast like find()).
        const match = {};
        Object.keys( restQuery ).forEach( ( key ) => {
            const val = restQuery[ key ];
            if ( val === undefined || val === '' ) {
                return;
            }
            // Aggregation does not auto-cast, so every ObjectId ref filter has
            // to be converted or it silently matches nothing.
            const REF_KEYS = [
                'shop', 'category', 'motherCategory', 'company', 'capacity'
            ];
            if ( REF_KEYS.includes( key ) && mongoose.Types.ObjectId.isValid( val ) ) {
                match[ key ] = new mongoose.Types.ObjectId( val );
            } else if ( key === 'status' ) {
                match[ key ] = val === true || val === 'true';
            } else {
                match[ key ] = val;
            }
        } );

        if ( search && Array.isArray( searchFields ) && searchFields.length ) {
            const term = String( search ).trim();
            if ( term ) {
                match.$or = searchFields.map( ( field ) => ( {
                    [ field ]: { $regex: term, $options: 'i' }
                } ) );
            }
        }

        const categoryCollection = mongoose.model( 'category' ).collection.collectionName;
        const sortStage = this.buildSort( sortBy );


        try {
            const pipeline = [
                { $match: match },
                {
                    $lookup: {
                        from: categoryCollection,
                        localField: 'category',
                        foreignField: '_id',
                        as: 'categoryDoc'
                    }
                },
                { $unwind: { path: '$categoryDoc', preserveNullAndEmptyArrays: true } },
                { $sort: sortStage },
                { $skip: skip },
                { $limit: limit }
            ];

            let items = await this.model.aggregate( pipeline );
            // Drop the lookup helper, then populate refs so the response shape
            // matches the normal find()+populate() output used by the DTOs.
            items.forEach( ( it ) => delete it.categoryDoc );
            items = await this.model.populate( items, this.populateFields );

            const total = await this.model.countDocuments( match );
            const hasNext = skip + items.length < total;

            return { 'data': this.parseObj( items ), total, hasNext, metaData: {} };
        } catch ( errors ) {
            throw errors;
        }
    }

    /**
     * Auto-assign the next displayNumber when one isn't provided. Numbering is
     * scoped per category, so each category keeps its own 1..n sequence
     * (e.g. Whisky 1-20, Beer 1-15).
     */
    async insert( data ) {
        const payload = { ...data };
        if ( payload.displayNumber === undefined || payload.displayNumber === null ) {
            const filter = payload.category ? { 'category': payload.category } : {};
            const last = await this.model
                .findOne( filter )
                .sort( { 'displayNumber': -1 } )
                .select( 'displayNumber' );
            payload.displayNumber = last ? ( last.displayNumber || 0 ) + 1 : 1;
        }
        return super.insert( payload );
    }

    /**
     * Persist a new product ordering in one bulk write.
     * @param { Array<{ id: string, displayNumber: number }> } items
     */
    async reorder( items ) {
        if ( !Array.isArray( items ) || !items.length ) {
            return { 'data': { 'updated': 0 } };
        }
        const operations = items
            .filter( ( it ) => it && it.id )
            .map( ( it ) => ( {
                'updateOne': {
                    'filter': { '_id': it.id },
                    'update': { '$set': { 'displayNumber': Number( it.displayNumber ) } }
                }
            } ) );

        if ( !operations.length ) {
            return { 'data': { 'updated': 0 } };
        }
        const result = await this.model.bulkWrite( operations );
        return { 'data': { 'updated': result.modifiedCount } };
    }

    /**
     * Build the .xlsx bulk-import template. The columns mirror the product
     * form in the admin UI, in the same order. Every lookup column (shop,
     * category, company, motherCategory, capacity) and every fixed-choice
     * column (mainUnit, alternateUnit, status) carries a data-validation
     * dropdown fed from the live catalogue, so only valid values can be typed.
     * @returns { Promise<import('exceljs').Workbook> }
     */
    async buildTemplateWorkbook() {
        // One dropdown per lookup field on the product form.
        const byOrder = { 'displayNumber': 1, 'name': 1 };
        const activeNames = ( modelName ) => mongoose.model( modelName )
            .find( { 'status': true } ).sort( byOrder ).select( 'name' ).lean();
        const [ categories, shops, companies, motherCategories, capacities ] =
            await Promise.all( [
                activeNames( 'category' ),
                activeNames( 'shop' ),
                activeNames( 'company' ),
                activeNames( 'mothercategory' ),
                activeNames( 'capacity' )
            ] );
        const categoryNames = categories.map( ( c ) => c.name );
        const shopNames = shops.map( ( s ) => s.name );
        const companyNames = companies.map( ( c ) => c.name );
        const motherCategoryNames = motherCategories.map( ( m ) => m.name );
        const capacityNames = capacities.map( ( c ) => c.name );

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet( 'Products' );

        ws.columns = TEMPLATE_COLUMNS;
        const header = ws.getRow( 1 );
        header.font = { 'bold': true };
        header.alignment = { 'horizontal': 'center' };

        // The dropdown source lists live on a SEPARATE hidden sheet and are
        // referenced through workbook defined names (named ranges). This is the
        // method Excel fully supports for list validations — a filled example
        // row therefore stays at row 2 regardless of how many list values exist,
        // and the dropdowns render with every active value.
        const lists = wb.addWorksheet( 'Lists' );
        categoryNames.forEach( ( n, i ) => {
            lists.getCell( `A${ i + 1 }` ).value = n;
        } );
        MAIN_UNITS.forEach( ( n, i ) => {
            lists.getCell( `B${ i + 1 }` ).value = n;
        } );
        ALTERNATE_UNITS.forEach( ( n, i ) => {
            lists.getCell( `C${ i + 1 }` ).value = n;
        } );
        shopNames.forEach( ( n, i ) => {
            lists.getCell( `D${ i + 1 }` ).value = n;
        } );
        companyNames.forEach( ( n, i ) => {
            lists.getCell( `E${ i + 1 }` ).value = n;
        } );
        motherCategoryNames.forEach( ( n, i ) => {
            lists.getCell( `F${ i + 1 }` ).value = n;
        } );
        capacityNames.forEach( ( n, i ) => {
            lists.getCell( `G${ i + 1 }` ).value = n;
        } );
        STATUS_VALUES.forEach( ( n, i ) => {
            lists.getCell( `H${ i + 1 }` ).value = n;
        } );
        lists.state = 'hidden';

        // Named ranges → validation sources.
        if ( categoryNames.length ) {
            wb.definedNames.add(
                `Lists!$A$1:$A$${ categoryNames.length }`, 'CategoryList'
            );
        }
        wb.definedNames.add(
            `Lists!$B$1:$B$${ MAIN_UNITS.length }`, 'MainUnitList'
        );
        wb.definedNames.add(
            `Lists!$C$1:$C$${ ALTERNATE_UNITS.length }`, 'AlternateUnitList'
        );
        if ( shopNames.length ) {
            wb.definedNames.add(
                `Lists!$D$1:$D${ shopNames.length }`, 'ShopList'
            );
        }
        if ( companyNames.length ) {
            wb.definedNames.add(
                `Lists!$E$1:$E${ companyNames.length }`, 'CompanyList'
            );
        }
        if ( motherCategoryNames.length ) {
            wb.definedNames.add(
                `Lists!$F$1:$F${ motherCategoryNames.length }`, 'MotherCategoryList'
            );
        }
        if ( capacityNames.length ) {
            wb.definedNames.add(
                `Lists!$G$1:$G${ capacityNames.length }`, 'CapacityList'
            );
        }
        wb.definedNames.add(
            `Lists!$H$1:$H${ STATUS_VALUES.length }`, 'StatusList'
        );

        // A filled example row (row 2) so the expected shape is obvious.
        ws.addRow( {
            'shop': shopNames[ 0 ] || 'MAIN SHOP',
            'name': 'Example Whisky 750 ml',
            'category': categoryNames[ 0 ] || 'WHISKY',
            'company': companyNames[ 0 ] || 'EXAMPLE DISTILLERY',
            'motherCategory': motherCategoryNames[ 0 ] || '',
            'capacity': capacityNames[ 0 ] || '',
            'mrp': 80,
            'purchasePrice': 64,
            'mainUnit': 'BOTTLE',
            'alternateUnit': 'CASE',
            'perAlternateUnitQty': 12,
            'stockAlertQty': 10,
            'inventory': 0,
            'status': 'YES'
        } );

        // One list validation per column over the whole data range. A single,
        // non-overlapping sqref per column keeps the workbook valid (overlapping
        // ranges make Excel flag the file as corrupt and drop the dropdowns).
        // Column layout: A shop | B name | C category | D company |
        // E motherCategory | F capacity | G mrp | H purchasePrice |
        // I mainUnit | J alternateUnit | K perAlternateUnitQty |
        // L stockAlertQty | M inventory | N status.
        const lastRow = 1000;
        const listValidation = ( name, message ) => ( {
            'type': 'list',
            'allowBlank': true,
            'formulae': [ name ],
            'showErrorMessage': true,
            'errorStyle': 'error',
            'errorTitle': 'Invalid value',
            'error': message
        } );
        if ( shopNames.length ) {
            ws.dataValidations.add(
                `A2:A${ lastRow }`,
                listValidation( 'ShopList', 'Pick a shop from the list.' )
            );
        }
        if ( categoryNames.length ) {
            ws.dataValidations.add(
                `C2:C${ lastRow }`,
                listValidation( 'CategoryList', 'Pick a category from the list.' )
            );
        }
        if ( companyNames.length ) {
            ws.dataValidations.add(
                `D2:D${ lastRow }`,
                listValidation( 'CompanyList', 'Pick a company from the list.' )
            );
        }
        if ( motherCategoryNames.length ) {
            ws.dataValidations.add(
                `E2:E${ lastRow }`,
                listValidation(
                    'MotherCategoryList', 'Pick a mother category from the list.'
                )
            );
        }
        if ( capacityNames.length ) {
            ws.dataValidations.add(
                `F2:F${ lastRow }`,
                listValidation( 'CapacityList', 'Pick a capacity from the list.' )
            );
        }
        ws.dataValidations.add(
            `I2:I${ lastRow }`,
            listValidation( 'MainUnitList', 'Pick a main unit from the list.' )
        );
        ws.dataValidations.add(
            `J2:J${ lastRow }`,
            listValidation(
                'AlternateUnitList', 'Pick an alternate unit from the list.'
            )
        );
        ws.dataValidations.add(
            `N2:N${ lastRow }`,
            listValidation( 'StatusList', 'Status must be YES or NO.' )
        );

        return wb;
    }

    /**
     * Build an .xlsx export of every product, using the same column layout as
     * the import template (so an exported file can be edited and re-uploaded).
     * Every reference is written as its name, and status as YES / NO.
     * @returns { Promise<import('exceljs').Workbook> }
     */
    async buildItemsWorkbook( shopId ) {
        const filter = {};
        if ( shopId && mongoose.Types.ObjectId.isValid( shopId ) ) {
            filter.shop = new mongoose.Types.ObjectId( shopId );
        }
        const products = await this.model
            .find( filter )
            .sort( { 'displayNumber': 1, 'createdAt': 1 } )
            .populate( [
                { 'path': 'shop', 'select': 'name' },
                { 'path': 'category', 'select': 'name' },
                { 'path': 'company', 'select': 'name' },
                { 'path': 'motherCategory', 'select': 'name' },
                { 'path': 'capacity', 'select': 'name' }
            ] )
            .lean();

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet( 'Products' );
        ws.columns = EXPORT_COLUMNS;
        const header = ws.getRow( 1 );
        header.font = { 'bold': true };
        header.alignment = { 'horizontal': 'center' };

        const refName = ( ref ) => ( ref && ref.name ) || '';
        products.forEach( ( p ) => {
            ws.addRow( {
                '_id': String( p._id ),
                'shop': refName( p.shop ),
                'name': p.name || '',
                'category': refName( p.category ),
                'company': refName( p.company ),
                'motherCategory': refName( p.motherCategory ),
                'capacity': refName( p.capacity ),
                'mrp': p.mrp,
                'purchasePrice': p.purchasePrice,
                'mainUnit': p.mainUnit || '',
                'alternateUnit': p.alternateUnit || '',
                'perAlternateUnitQty': p.perAlternateUnitQty,
                'stockAlertQty': p.stockAlertQty,
                'inventory': p.inventory,
                'status': p.status === false ? 'NO' : 'YES'
            } );
        } );

        return wb;
    }

    /**
     * Build a grouped price-list PDF: each active category as a heading
     * followed by its active products, in the same order as the catalogue
     * (category displayNumber, then product displayNumber). The rate column is
     * the retail `mrp` or the `purchasePrice` depending on `type`.
     * @param { 'retailer' | 'wholesale' } type
     * @param { string } [shopId] - limit the list to one shop
     * @returns { Promise<Buffer> }
     */
    async buildPriceListPdf( type, shopId ) {
        const wholesale = type === 'wholesale';
        const Category = mongoose.model( 'category' );
        // A price list is per outlet; without a shop it would mix every shop's
        // catalogue into one document.
        const productFilter = { 'status': true };
        if ( shopId && mongoose.Types.ObjectId.isValid( shopId ) ) {
            productFilter.shop = new mongoose.Types.ObjectId( shopId );
        }
        const [ categories, products ] = await Promise.all( [
            Category.find( { 'status': true } )
                .sort( { 'displayNumber': 1, 'name': 1 } )
                .select( 'name' ).lean(),
            this.model.find( productFilter )
                .sort( { 'displayNumber': 1, 'createdAt': 1 } )
                .populate( [
                    { 'path': 'category', 'select': 'name' }
                ] )
                .lean()
        ] );

        // Group products by their category id (preserves the sorted order).
        const byCategory = new Map();
        const orphans = [];
        products.forEach( ( p ) => {
            const id = p.category && p.category._id
                ? String( p.category._id ) : null;
            if ( !id ) {
                orphans.push( p );
                return;
            }
            if ( !byCategory.has( id ) ) byCategory.set( id, [] );
            byCategory.get( id ).push( p );
        } );

        const groups = categories
            .map( ( c ) => ( {
                'name': c.name,
                'items': byCategory.get( String( c._id ) ) || []
            } ) )
            .filter( ( g ) => g.items.length );
        if ( orphans.length ) {
            groups.push( { 'name': 'Others', 'items': orphans } );
        }

        const money = ( n ) => '₹' + Number( n || 0 ).toLocaleString( 'en-IN' );
        const rateOf = ( p ) => ( wholesale ? p.purchasePrice : p.mrp );

        const doc = new PDFDocument( { 'size': 'A4', 'margin': 40 } );
        // Register the embedded Unicode fonts and use them throughout, so the
        // rupee sign (₹) and the registered mark (®) render correctly.
        doc.registerFont( 'Body', FONT_REGULAR );
        doc.registerFont( 'BodyBold', FONT_BOLD );
        const FONT = 'Body';
        const FONT_B = 'BodyBold';
        const chunks = [];
        doc.on( 'data', ( c ) => chunks.push( c ) );
        const done = new Promise( ( resolve, reject ) => {
            doc.on( 'end', () => resolve( Buffer.concat( chunks ) ) );
            doc.on( 'error', reject );
        } );

        const accent = wholesale ? '#b45309' : '#b91c1c'; // amber / red
        const left = doc.page.margins.left;
        const right = doc.page.width - doc.page.margins.right;
        const tableW = right - left;
        const bottom = () => doc.page.height - doc.page.margins.bottom;
        const PAD = 6;

        // Column geometry: S.No | Item | Rate | Unit. The Item column flexes
        // to fill whatever the fixed columns leave. (The Code column went with
        // the `code` field.)
        const wSno = 48;
        const wUnit = 46;
        const wRate = 88;
        const wItem = tableW - wSno - wUnit - wRate;
        const ITEM_COL = 1; // index of the wrapping column
        // Each column: [x, width, align], left-to-right.
        const widths = [ wSno, wItem, wRate, wUnit ];
        // Every column centered except the Item column, which stays left.
        const aligns = [ 'center', 'left', 'center', 'center' ];
        const cols = [];
        let cx = left;
        widths.forEach( ( w, i ) => {
            cols.push( [ cx, w, aligns[ i ] ] );
            cx += w;
        } );

        // Title. The wholesale sheet reads simply "Price List"; the retailer
        // sheet carries a trailing ® so staff can tell the two apart.
        doc.font( FONT_B ).fontSize( 18 ).fillColor( '#111' )
            .text(
                `Price List${ wholesale ? '' : ' ®' }`,
                left, doc.y, { 'width': tableW, 'align': 'center' }
            );
        doc.font( FONT ).fontSize( 9 ).fillColor( '#666' )
            .text(
                new Date().toLocaleDateString( 'en-IN', {
                    'day': '2-digit', 'month': 'short', 'year': 'numeric'
                } ),
                left, doc.y + 2, { 'width': tableW, 'align': 'center' }
            );
        doc.fillColor( '#000' ).moveDown( 1.2 );

        // Draw one bordered table row.
        // cells = [sno, item, rate, unit].
        const drawRow = ( cells, opts = {} ) => {
            const fontName = opts.bold ? FONT_B : FONT;
            const size = opts.size || 10;
            doc.font( fontName ).fontSize( size );
            const itemH = doc.heightOfString( String( cells[ ITEM_COL ] ), {
                'width': wItem - PAD * 2
            } );
            const rowH = Math.max( opts.minH || 18, itemH + PAD * 2 );

            if ( doc.y + rowH > bottom() ) doc.addPage();
            const y = doc.y;

            if ( opts.fill ) {
                doc.rect( left, y, tableW, rowH ).fill( opts.fill );
            }
            // Column separators + outer border.
            doc.lineWidth( 0.5 ).strokeColor( '#d1d5db' );
            cols.forEach( ( [ x ] ) => {
                doc.moveTo( x, y ).lineTo( x, y + rowH ).stroke();
            } );
            doc.moveTo( right, y ).lineTo( right, y + rowH ).stroke();
            doc.rect( left, y, tableW, rowH ).stroke();

            const tc = opts.color || '#111';
            doc.fillColor( tc ).font( fontName ).fontSize( size );
            cells.forEach( ( val, i ) => {
                const [ x, w, align ] = cols[ i ];
                doc.text( String( val ), x + PAD, y + PAD,
                    { 'width': w - PAD * 2, 'align': align } );
            } );

            doc.fillColor( '#000' ).y = y + rowH;
        };

        // A full-width category band.
        const drawCategoryBand = ( name ) => {
            const h = 22;
            if ( doc.y + h + 20 > bottom() ) doc.addPage();
            const y = doc.y;
            doc.rect( left, y, tableW, h ).fill( accent );
            doc.fillColor( '#fff' ).font( FONT_B ).fontSize( 11 )
                .text( String( name ).toUpperCase(), left + PAD, y + 6,
                    { 'width': tableW - PAD * 2, 'align': 'center' } );
            doc.fillColor( '#000' ).y = y + h;
        };

        groups.forEach( ( group ) => {
            drawCategoryBand( group.name );
            // Column header for this category's table.
            drawRow( [ 'S.NO', 'ITEM', 'RATE', 'UNIT' ], {
                'bold': true, 'size': 9, 'fill': '#f3f4f6', 'color': '#374151'
            } );
            group.items.forEach( ( p, i ) => {
                drawRow(
                    [
                        String( i + 1 ),
                        p.name || '',
                        money( rateOf( p ) ),
                        ( p.mainUnit || '' ).toUpperCase()
                    ],
                    { 'fill': i % 2 ? '#fafafa' : null }
                );
            } );
            doc.moveDown( 0.8 );
        } );

        if ( !groups.length ) {
            doc.font( FONT ).fontSize( 11 )
                .text( 'No active products to list.', left, doc.y,
                    { 'width': tableW, 'align': 'center' } );
        }

        doc.end();
        return done;
    }

    /**
     * Parse an exported .xlsx and update product prices by _id. Only `mrp`
     * and `purchasePrice` are touched; a row is matched to a product by its
     * `_id` column. Invalid rows are reported and skipped.
     * @param { Buffer } buffer - the uploaded workbook
     * @param { string } [userId] - the editing admin (stored as updatedBy)
     * @returns { Promise<{ updated: number, failed: number, errors: Array }> }
     */
    async updatePricesFromFile( buffer, userId ) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load( buffer );
        const ws = wb.getWorksheet( 'Products' ) || wb.worksheets[ 0 ];
        if ( !ws ) {
            const error = new Error( 'No sheet found in the file.' );
            error.statusCode = 400;
            throw error;
        }

        // Map columns by header name so column order can vary.
        const colIndex = {};
        ws.getRow( 1 ).eachCell( ( cell, col ) => {
            colIndex[ String( cellText( cell.value ) ).trim().toLowerCase() ] = col;
        } );
        if ( !colIndex[ '_id' ] ) {
            const error = new Error( 'The file must include an "_id" column.' );
            error.statusCode = 400;
            throw error;
        }
        const cellOf = ( row, name ) => {
            const idx = colIndex[ name.toLowerCase() ];
            if ( !idx ) return '';
            return cellText( row.getCell( idx ).value );
        };

        const operations = [];
        const errors = [];

        for ( let r = 2; r <= ws.rowCount; r++ ) {
            const row = ws.getRow( r );
            const id = String( cellOf( row, '_id' ) ).trim();
            const rawMrp = cellOf( row, 'mrp' );
            const rawPurchase = cellOf( row, 'purchasePrice' );
            const rawAlertQty = cellOf( row, 'stockAlertQty' );

            // Skip blank rows entirely.
            if ( !id && rawMrp === '' && rawPurchase === '' && rawAlertQty === '' ) continue;

            const rowErrors = [];
            if ( !id || !mongoose.Types.ObjectId.isValid( id ) ) {
                rowErrors.push( `invalid _id "${ id }"` );
            }

            const set = {};
            if ( rawMrp !== '' && rawMrp !== null && rawMrp !== undefined ) {
                const mrp = Number( rawMrp );
                if ( !Number.isFinite( mrp ) || mrp < 0 ) {
                    rowErrors.push( 'mrp is invalid' );
                } else {
                    set.mrp = Number( mrp.toFixed( 2 ) );
                }
            }
            if ( rawPurchase !== '' && rawPurchase !== null && rawPurchase !== undefined ) {
                const purchasePrice = Number( rawPurchase );
                if ( !Number.isFinite( purchasePrice ) || purchasePrice < 0 ) {
                    rowErrors.push( 'purchasePrice is invalid' );
                } else {
                    set.purchasePrice = Number( purchasePrice.toFixed( 2 ) );
                }
            }
            if ( rawAlertQty !== '' && rawAlertQty !== null && rawAlertQty !== undefined ) {
                const stockAlertQty = Number( rawAlertQty );
                if ( !Number.isInteger( stockAlertQty ) || stockAlertQty < 0 ) {
                    rowErrors.push( 'stockAlertQty must be a whole number of 0 or more' );
                } else {
                    set.stockAlertQty = stockAlertQty;
                }
            }
            if ( !rowErrors.length && Object.keys( set ).length === 0 ) {
                rowErrors.push( 'no mrp, purchasePrice or stockAlertQty to update' );
            }

            if ( rowErrors.length ) {
                errors.push( { 'row': r, 'errors': rowErrors } );
                continue;
            }

            if ( userId ) set.updatedBy = userId;
            operations.push( {
                'updateOne': {
                    'filter': { '_id': id },
                    'update': { '$set': set }
                }
            } );
        }

        let updated = 0;
        if ( operations.length ) {
            const result = await this.model.bulkWrite( operations );
            updated = ( result.modifiedCount || 0 );
        }

        return { updated, 'failed': errors.length, errors };
    }

    /**
     * Parse a filled .xlsx template buffer and bulk-create products. Every
     * lookup column (shop, category, company, motherCategory, capacity) is
     * resolved from a name to an id, case-insensitively; invalid rows are
     * reported back and skipped rather than failing the whole import.
     * @param { Buffer } buffer - the uploaded workbook
     * @param { string } [userId] - the importing admin (stored as createdBy)
     * @returns { Promise<{ created: number, failed: number, errors: Array }> }
     */
    async importFromTemplate( buffer, userId ) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load( buffer );
        const ws = wb.getWorksheet( 'Products' ) || wb.worksheets[ 0 ];
        if ( !ws ) {
            const error = new Error( 'No sheet found in the template.' );
            error.statusCode = 400;
            throw error;
        }

        // Name -> _id for every lookup column, matched case-insensitively.
        const allNames = ( modelName ) => mongoose.model( modelName )
            .find().select( 'name' ).lean();
        const [ categories, shops, companies, motherCategories, capacities ] =
            await Promise.all( [
                allNames( 'category' ),
                allNames( 'shop' ),
                allNames( 'company' ),
                allNames( 'mothercategory' ),
                allNames( 'capacity' )
            ] );
        const idMap = ( rows ) => new Map(
            rows.map( ( r ) => [ String( r.name ).trim().toLowerCase(), r._id ] )
        );
        const catMap = idMap( categories );
        const shopMap = idMap( shops );
        const companyMap = idMap( companies );
        const motherCatMap = idMap( motherCategories );
        const capacityMap = idMap( capacities );

        // Map columns by their header name so column order can vary.
        const colIndex = {};
        ws.getRow( 1 ).eachCell( ( cell, col ) => {
            colIndex[ String( cellText( cell.value ) ).trim().toLowerCase() ] = col;
        } );
        const cellOf = ( row, name ) => {
            const idx = colIndex[ name.toLowerCase() ];
            if ( !idx ) return '';
            return cellText( row.getCell( idx ).value );
        };

        const docs = [];
        const errors = [];

        for ( let r = 2; r <= ws.rowCount; r++ ) {
            const row = ws.getRow( r );
            const name = String( cellOf( row, 'name' ) ).trim();
            const catName = String( cellOf( row, 'category' ) ).trim();
            const shopName = String( cellOf( row, 'shop' ) ).trim();
            const companyName = String( cellOf( row, 'company' ) ).trim();
            const motherCatName = String( cellOf( row, 'motherCategory' ) ).trim();
            const capacityName = String( cellOf( row, 'capacity' ) ).trim();

            // Skip blank rows entirely.
            if ( !name && !catName && !shopName ) continue;

            // Blank unit cells fall back to the single allowed value, so an
            // older template without these columns still imports.
            const mainUnit = String(
                cellOf( row, 'mainUnit' ) || 'BOTTLE'
            ).trim().toUpperCase();
            const alternateUnit = String(
                cellOf( row, 'alternateUnit' ) || 'CASE'
            ).trim().toUpperCase();
            const mrp = Number( cellOf( row, 'mrp' ) );
            const purchasePrice = Number( cellOf( row, 'purchasePrice' ) );
            // Main units per alternate unit. A blank cell defaults to 1;
            // anything present must be a whole number of at least 1.
            const rawPerAlt = String( cellOf( row, 'perAlternateUnitQty' ) ).trim();
            const perAlternateUnitQty = rawPerAlt === '' ? 1 : Number( rawPerAlt );
            // Low-stock threshold and opening stock both default to 0.
            const rawAlertQty = String( cellOf( row, 'stockAlertQty' ) ).trim();
            const stockAlertQty = rawAlertQty === '' ? 0 : Number( rawAlertQty );
            const rawInventory = String( cellOf( row, 'inventory' ) ).trim();
            const inventory = rawInventory === '' ? 0 : Number( rawInventory );
            // Active unless the row says otherwise, so a template without the
            // status column (or with it left blank) still imports.
            const rawStatus = String( cellOf( row, 'status' ) ).trim().toUpperCase();

            const rowErrors = [];
            let status = true;
            if ( rawStatus !== '' ) {
                if ( STATUS_TRUE.includes( rawStatus ) ) status = true;
                else if ( STATUS_FALSE.includes( rawStatus ) ) status = false;
                else rowErrors.push( `status "${ rawStatus }" must be YES or NO` );
            }
            if ( !name ) rowErrors.push( 'name is required' );
            const shop = shopMap.get( shopName.toLowerCase() );
            if ( !shop ) rowErrors.push( `shop "${ shopName }" not found` );
            const category = catMap.get( catName.toLowerCase() );
            if ( !category ) rowErrors.push( `category "${ catName }" not found` );
            // Company is required on the form, so it is required here too.
            const company = companyMap.get( companyName.toLowerCase() );
            if ( !company ) rowErrors.push( `company "${ companyName }" not found` );
            // Mother category and capacity are optional: blank is fine, but a
            // value that matches nothing is an error rather than a silent drop.
            let motherCategory;
            if ( motherCatName ) {
                motherCategory = motherCatMap.get( motherCatName.toLowerCase() );
                if ( !motherCategory ) {
                    rowErrors.push( `motherCategory "${ motherCatName }" not found` );
                }
            }
            let capacity;
            if ( capacityName ) {
                capacity = capacityMap.get( capacityName.toLowerCase() );
                if ( !capacity ) {
                    rowErrors.push( `capacity "${ capacityName }" not found` );
                }
            }
            if ( !MAIN_UNITS.includes( mainUnit ) ) {
                rowErrors.push( `mainUnit "${ mainUnit }" is invalid` );
            }
            if ( !ALTERNATE_UNITS.includes( alternateUnit ) ) {
                rowErrors.push( `alternateUnit "${ alternateUnit }" is invalid` );
            }
            if ( !Number.isFinite( mrp ) || mrp < 0 ) rowErrors.push( 'mrp is invalid' );
            if ( !Number.isFinite( purchasePrice ) || purchasePrice < 0 ) {
                rowErrors.push( 'purchasePrice is invalid' );
            }
            if ( !Number.isInteger( perAlternateUnitQty ) || perAlternateUnitQty < 1 ) {
                rowErrors.push( 'perAlternateUnitQty must be a whole number of at least 1' );
            }
            if ( !Number.isInteger( stockAlertQty ) || stockAlertQty < 0 ) {
                rowErrors.push( 'stockAlertQty must be a whole number of 0 or more' );
            }
            if ( !Number.isInteger( inventory ) || inventory < 0 ) {
                rowErrors.push( 'inventory must be a whole number of 0 or more' );
            }

            if ( rowErrors.length ) {
                errors.push( { 'row': r, 'errors': rowErrors } );
                continue;
            }

            const doc = {
                name, shop, category, company, mrp, purchasePrice,
                mainUnit, alternateUnit, perAlternateUnitQty, stockAlertQty,
                inventory, status,
                'createdBy': userId
            };
            // Leave the optional refs off entirely when blank; an explicit
            // undefined would still write a null into the document.
            if ( motherCategory ) doc.motherCategory = motherCategory;
            if ( capacity ) doc.capacity = capacity;
            docs.push( doc );
        }

        let created = 0;
        if ( docs.length ) {
            const inserted = await this.model.insertMany( docs, { 'ordered': false } );
            created = inserted.length;
        }

        return { created, 'failed': errors.length, errors };
    }
}

module.exports = { ProductService };
