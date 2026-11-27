'use strict';
/**
 * The West Bengal retail excise return (e-Report Return: Retail), line for line.
 *
 * Each row carries the form's own code (IF-01, OI-06, …), the sub-type label it
 * prints, and the database category it reads its litreage from — the categories
 * are named with the group as a prefix ("IMFL WHISKY", "OSBI RUM", "OS GIN &
 * LIQUEURS", the bare "WINE" and "LAB", "BEER MADE IN INDIA"), so a row maps to
 * exactly one category by name. A row whose `category` is null has no matching
 * category yet (Bhutan/Nepal beer, India Made Liquor) and simply reads zero.
 *
 * Every section rolls up into one of three totals — Foreign Liquor (TFL), Beer
 * (TBR) or India Made Liquor (TIML) — via its `total` key.
 */

const SECTIONS = [
    {
        'title': 'Foreign Liquor',
        'total': 'FL',
        'rows': [
            [ 'IF-01', 'Whisky', 'IMFL WHISKY' ],
            [ 'IF-02', 'Rum', 'IMFL RUM' ],
            [ 'IF-03', 'Vodka', 'IMFL VODKA' ],
            [ 'IF-04', 'Brandy', 'IMFL BRANDY' ],
            [ 'IF-05', 'Gin & Liqueurs', 'IMFL GIN & LIQUEURS' ]
        ]
    },
    {
        'title': 'Overseas Spirits Bottled in India',
        'total': 'FL',
        'rows': [
            [ 'OI-06', 'Whisky', 'OSBI WHISKY' ],
            [ 'OI-07', 'Rum', 'OSBI RUM' ],
            [ 'OI-08', 'Vodka', 'OSBI VODKA' ],
            [ 'OI-09', 'Brandy', 'OSBI BRANDY' ],
            [ 'OI-10', 'Gin & Liqueurs', 'OSBI GIN & LIQUEURS' ]
        ]
    },
    {
        'title': 'Overseas Spirits',
        'total': 'FL',
        'rows': [
            [ 'OS-11', 'Whisky', 'OS WHISKY' ],
            [ 'OS-12', 'Rum', 'OS RUM' ],
            [ 'OS-13', 'Vodka', 'OS VODKA' ],
            [ 'OS-14', 'Brandy', 'OS BRANDY' ],
            [ 'OS-15', 'Gin & Liqueurs', 'OS GIN & LIQUEURS' ]
        ]
    },
    {
        'title': 'Other Spirits',
        'total': 'FL',
        'rows': [
            [ 'SS-16', 'Wines', 'WINE' ],
            [ 'SS-17', 'Low Alcoholic Beverages', 'LAB' ]
        ]
    },
    {
        'title': 'Beer',
        'total': 'BR',
        'rows': [
            [ 'BR-18', 'Beer made in India', 'BEER MADE IN INDIA' ],
            [ 'BR-19', 'Beer manufactured overseas', 'BEER MANUFACTURED OVERSEAS' ]
        ]
    },
   
];

/** The three section totals the form carries, each summing one `total` key. */
const TOTALS = [
    { 'code': 'TFL', 'label': 'Total : Foreign Liquor', 'of': 'FL' },
    { 'code': 'TBR', 'label': 'Total : Beer', 'of': 'BR' },
];

module.exports = { SECTIONS, TOTALS };
