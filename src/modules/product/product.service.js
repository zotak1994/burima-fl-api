'use strict';
const mongoose = require( 'mongoose' );
const ExcelJS = require( 'exceljs' );
const {
    CalmService, NAMED_SORTS, NAME_COLLATION, needsNameCollation
} = require( '../../../system/core/CalmService' );
const { CalmError } = require( '../../../system/core/CalmError' );

// Products carry the shared named sorts, except that their "display" order
// is the catalogue order: category position first, then the product's own
// position within it.
const PRODUCT_NAMED_SORTS = {
    ...NAMED_SORTS,
    'display': {
        'categoryDoc.displayNumber': 1, 'displayNumber': 1, 'createdAt': 1
    }
};

// Keep these in step with the enums on the product model.
const MAIN_UNITS = [ 'BOTTLE' ];
const ALTERNATE_UNITS = [ 'CASE' ];
// Column order of the bulk-import template. Deliberately the same field
// order as the product form in the admin UI, with `shop` in front because
// a file may span outlets.
const TEMPLATE_COLUMNS = [
    { 'header': 'shop', 'key': 'shop', 'width': 22 },
    { 'header': 'motherCategory', 'key': 'motherCategory', 'width': 22 },
    { 'header': 'category', 'key': 'category', 'width': 22 },
    { 'header': 'company', 'key': 'company', 'width': 22 },
    { 'header': 'code', 'key': 'code', 'width': 16 },
    { 'header': 'name', 'key': 'name', 'width': 36 },
    { 'header': 'measurement', 'key': 'capacity', 'width': 14 },
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
// Export layout: the template columns prefixed with the product's _id, which
// identifies the row unambiguously when comparing an export against the data.
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

/**
 * Trim and upper-case a product code. A blank value becomes undefined, which
 * means "no code" — never an empty string, because the partial unique index
 * counts '' as a real value and so would let only one product have a blank.
 * @param { * } value
 * @returns { string | undefined }
 */
function normaliseCode( value ) {
    if ( value === null || value === undefined ) return undefined;
    const text = String( cellText( value ) ).trim().toUpperCase();
    return text === '' ? undefined : text;
}

/**
 * Resolve a required lookup cell to an id, recording a readable message when
 * the cell is blank or names something that does not exist.
 * @param { string } label - the column name, used in the message
 * @param { Map<string, *> } map - lower-cased name -> id
 * @param { string } raw - the cell's trimmed text
 * @param { string[] } rowErrors - collected messages for this row
 * @returns { * | undefined }
 */
function resolveRequiredRef( label, map, raw, rowErrors ) {
    if ( !raw ) {
        rowErrors.push( `${ label } is required` );
        return undefined;
    }
    const id = map.get( String( raw ).toLowerCase() );
    if ( !id ) rowErrors.push( `${ label } "${ raw }" not found` );
    return id;
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
    searchFields = [ 'name', 'code' ];
    constructor( model ) {
        super( model );
    }

    /**
     * Convert a sortBy value (Mongo object, or a space-separated string like
     * '-mrp name') into an aggregation $sort object.
     */
    buildSort( sortBy, sort ) {
        // A named order wins over sortBy — see CalmService.getAll.
        const key = String( sort || '' ).trim().toLowerCase();
        if ( PRODUCT_NAMED_SORTS[ key ] ) {
            return PRODUCT_NAMED_SORTS[ key ];
        }
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
        // `sort` is pulled out here for the same reason as in CalmService:
        // a leftover key becomes an exact-match filter on a missing field.
        // eslint-disable-next-line prefer-const
        let { skip, limit, sortBy, sort, search, ...restQuery } = query;
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
        const sortStage = this.buildSort( sortBy, sort );


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

            const aggregation = this.model.aggregate( pipeline );
            if ( needsNameCollation( sort ) ) {
                // Same reason as CalmService: byte order would put every
                // capital ahead of every lower-case letter.
                aggregation.collation( NAME_COLLATION );
            }
            let items = await aggregation;
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
        const code = normaliseCode( payload.code );
        if ( code === undefined ) {
            // Drop the key rather than store '' — see normaliseCode.
            delete payload.code;
        } else {
            payload.code = code;
            await this.assertCodeFree( payload.shop, code );
        }
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
     * Reject a product code already used by another product in the same shop.
     * Codes are per shop, so the same code in a different outlet is fine.
     * @param { * } shop - the owning shop's id
     * @param { string } code - an already-normalised code
     * @param { string } [excludeId] - the product being edited, if any
     */
    async assertCodeFree( shop, code, excludeId ) {
        if ( !shop || !code ) return;
        const filter = { 'shop': shop, 'code': code };
        if ( excludeId ) filter._id = { '$ne': excludeId };
        const clash = await this.model.findOne( filter ).select( 'name' ).lean();
        if ( clash ) {
            throw new CalmError(
                'VALIDATION_ERROR',
                `Code "${ code }" is already used by "${ clash.name }" in this shop.`
            );
        }
    }

    /**
     * Normalise the code on the way in, and let an explicitly blank code clear
     * the stored one.
     * @param { string } id
     * @param { object } data
     */
    async update( id, data ) {
        const payload = { ...data };
        if ( 'code' in payload ) {
            const code = normaliseCode( payload.code );
            if ( code === undefined ) {
                // Cleared in the form: remove the field instead of writing ''.
                // Mongoose merges the plain fields into $set alongside this.
                delete payload.code;
                payload.$unset = { ...( payload.$unset || {} ), 'code': 1 };
            } else {
                payload.code = code;
                // The form always restates the shop, but fall back to the
                // product's own shop so a partial payload still validates.
                let shop = payload.shop;
                if ( !shop ) {
                    const current = await this.model.findById( id )
                        .select( 'shop' ).lean();
                    shop = current && current.shop;
                }
                await this.assertCodeFree( shop, code, id );
            }
        }
        return super.update( id, payload );
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
     * The name of one shop, for labelling a download. Empty when the id is
     * missing or unknown, so callers can fall back to an unlabelled filename.
     * @param { string } [shopId]
     * @returns { Promise<string> }
     */
    async shopLabel( shopId ) {
        if ( !shopId || !mongoose.Types.ObjectId.isValid( shopId ) ) return '';
        const shop = await mongoose.model( 'shop' )
            .findById( shopId ).select( 'name' ).lean();
        return ( shop && shop.name ) || '';
    }

    /**
     * Build the .xlsx bulk-import template. The columns mirror the product
     * form in the admin UI, in the same order. Every lookup column (shop,
     * category, company, motherCategory, capacity) and every fixed-choice
     * column (mainUnit, alternateUnit, status) carries a data-validation
     * dropdown fed from the live catalogue, so only valid values can be typed.
     * @returns { Promise<import('exceljs').Workbook> }
     */
    async buildTemplateWorkbook( shopId ) {
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
        // The shop this template was downloaded for. It is written on the
        // example row only; the importer carries it down to the rows below,
        // so it never has to be repeated. Every other shop stays in the
        // dropdown, so a file can still be retargeted or cover several
        // outlets by naming a new shop part-way down.
        const activeShopName = await this.shopLabel( shopId );

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
            'shop': activeShopName || shopNames[ 0 ] || 'MAIN SHOP',
            'motherCategory': motherCategoryNames[ 0 ] || 'IMFL',
            'category': categoryNames[ 0 ] || 'WHISKY',
            'company': companyNames[ 0 ] || 'EXAMPLE DISTILLERY',
            'code': 'WH-750-01',
            'name': 'Example Whisky 750 ml',
            'capacity': capacityNames[ 0 ] || '750 ml',
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
        // Column layout: A shop | B motherCategory | C category |
        // D company | E code | F name | G capacity | H mrp |
        // I purchasePrice | J mainUnit | K alternateUnit |
        // L perAlternateUnitQty | M stockAlertQty | N inventory | O status.
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
                `B2:B${ lastRow }`,
                listValidation(
                    'MotherCategoryList', 'Pick a mother category from the list.'
                )
            );
        }
        if ( capacityNames.length ) {
            ws.dataValidations.add(
                `G2:G${ lastRow }`,
                listValidation( 'CapacityList', 'Pick a capacity from the list.' )
            );
        }
        ws.dataValidations.add(
            `J2:J${ lastRow }`,
            listValidation( 'MainUnitList', 'Pick a main unit from the list.' )
        );
        ws.dataValidations.add(
            `K2:K${ lastRow }`,
            listValidation(
                'AlternateUnitList', 'Pick an alternate unit from the list.'
            )
        );
        ws.dataValidations.add(
            `O2:O${ lastRow }`,
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
                'motherCategory': refName( p.motherCategory ),
                'category': refName( p.category ),
                'company': refName( p.company ),
                'code': p.code || '',
                'name': p.name || '',
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
     * Parse a filled .xlsx template buffer and bulk-create products. Every
     * lookup column (shop, category, company, motherCategory, capacity) is
     * resolved from a name to an id, case-insensitively; invalid rows are
     * reported back and skipped rather than failing the whole import.
     * The shop column may be filled in once and left blank underneath: a
     * blank cell inherits the last shop named above it, and if the file never
     * names one at all, `defaultShopId` (the outlet the upload was made from)
     * is used.
     * @param { Buffer } buffer - the uploaded workbook
     * @param { string } [userId] - the importing admin (stored as createdBy)
     * @param { string } [defaultShopId] - shop for rows that name none
     * @returns { Promise<{ created: number, failed: number, errors: Array }> }
     */
    async importFromTemplate( buffer, userId, defaultShopId ) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load( buffer );
        const ws = wb.getWorksheet( 'Products' ) || wb.worksheets[ 0 ];
        if ( !ws ) {
            throw new CalmError(
                'VALIDATION_ERROR', 'No sheet found in the template.'
            );
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
        // Codes already taken, keyed shop|code, so the import can reject a
        // clash with the same readable message the form gives.
        const taken = new Set();
        const coded = await this.model
            .find( { 'code': { '$type': 'string' } } )
            .select( 'shop code' ).lean();
        coded.forEach( ( p ) => {
            taken.add( `${ String( p.shop ) }|${ String( p.code ).toUpperCase() }` );
        } );

        // Only honour a default shop that actually exists.
        let defaultShop;
        if ( defaultShopId && mongoose.Types.ObjectId.isValid( defaultShopId ) ) {
            const known = shops.some(
                ( s ) => String( s._id ) === String( defaultShopId )
            );
            if ( known ) defaultShop = new mongoose.Types.ObjectId( defaultShopId );
        }

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
        // The last shop named in the file, carried down to rows that leave the
        // column blank.
        let carriedShopName = '';

        for ( let r = 2; r <= ws.rowCount; r++ ) {
            const row = ws.getRow( r );
            const name = String( cellOf( row, 'name' ) ).trim();
            const catName = String( cellOf( row, 'category' ) ).trim();
            const shopName = String( cellOf( row, 'shop' ) ).trim();
            const code = normaliseCode( cellOf( row, 'code' ) );
            const companyName = String( cellOf( row, 'company' ) ).trim();
            const motherCatName = String( cellOf( row, 'motherCategory' ) ).trim();
            // 'capacity' is the header older templates carry; accept both.
            const capacityName = String(
                cellOf( row, 'measurement' ) || cellOf( row, 'capacity' )
            ).trim();

            // Skip blank rows entirely. The shop column is deliberately NOT
            // part of this test: the template ships with the shop pre-filled
            // down the sheet, so a row holding nothing but a shop name is an
            // untouched row, not an incomplete one.
            if (
                !name && !code && !catName && !companyName &&
                !motherCatName && !capacityName
            ) continue;

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
            // Every lookup column is required, exactly as on the product
            // form. A blank cell reports as missing rather than as a failed
            // lookup of an empty name.
            // The shop is stated once and inherited by the rows below it.
            if ( shopName ) carriedShopName = shopName;
            const effectiveShopName = shopName || carriedShopName;
            let shop;
            if ( effectiveShopName ) {
                shop = shopMap.get( effectiveShopName.toLowerCase() );
                if ( !shop ) {
                    rowErrors.push( `shop "${ effectiveShopName }" not found` );
                }
            } else if ( defaultShop ) {
                // Nothing named anywhere above: fall back to the outlet the
                // upload was made from.
                shop = defaultShop;
            } else {
                rowErrors.push( 'shop is required' );
            }
            const category = resolveRequiredRef(
                'category', catMap, catName, rowErrors
            );
            const motherCategory = resolveRequiredRef(
                'motherCategory', motherCatMap, motherCatName, rowErrors
            );
            const company = resolveRequiredRef(
                'company', companyMap, companyName, rowErrors
            );
            const capacity = resolveRequiredRef(
                'measurement', capacityMap, capacityName, rowErrors
            );
            // A code must be free within its shop — checked against the
            // database AND against the rows already read from this file, since
            // insertMany would otherwise fail the whole batch on the index.
            if ( code && shop ) {
                const key = `${ String( shop ) }|${ code }`;
                if ( taken.has( key ) ) {
                    rowErrors.push( `code "${ code }" is already used in this shop` );
                } else {
                    taken.add( key );
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
                name, shop, category, motherCategory, company, capacity,
                mrp, purchasePrice, mainUnit, alternateUnit,
                perAlternateUnitQty, stockAlertQty, inventory, status,
                'createdBy': userId
            };
            // Code is the only optional column left. Leave it off entirely
            // when blank: an explicit undefined would still write a null.
            if ( code ) doc.code = code;
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
