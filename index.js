const JT = require("jotascript").createBridge();

const inventor = JT.registerPlayer('inventor', 29923);
const gameCodeRoom = JT.registerRoom('Game Code Room', 29976, inventor);
const smartphone = JT.registerThing('smartphone', 29926, inventor, gameCodeRoom);

const testContext = JT.createContext(inventor, inventor);

//const innerField = JT.a_switch(7, 7, 4, "wut");
//const field = JT.a_switch(innerField, 4, "foo%cbar", "bar");

//console.log(field);
//console.log(JT.output(field));
//JT.output([innerField, field]);
//console.log(JT.output(innerField));
//JT.output(JT.a_switch(JT.a_print('a', 'b'), 'ab', 'yes', 'no'));

const booTest = JT.a_strloop(
    'hello world', 'x', JT.a_switch('%x', 'l', JT.a_print('Boo! '), '')
);
JT.output(booTest);
console.log(
    booTest.compile(testContext, true)
);

const outerReferenceTest = JT.a_let('foo', '%{bar}!',
    JT.a_countloop(10, 'bar',
        JT.a_print('%{foo}', ' ', '%{bar}')
    )
);
JT.output(outerReferenceTest);
console.log(
    outerReferenceTest.compile(testContext, true)
);

const mixedSubstitutionTest = JT.a_let('foo', JT.a_print('Heck'),
    JT.a_print('%{foo} yeah!')
);
JT.output(mixedSubstitutionTest);
console.log(
    mixedSubstitutionTest.compile(testContext, true)
);

/*JT.output(
    JT.a_print('hello ','world')
);*/
smartphone.init()
.registerArray('testarray', true,
    3, 5, 7, 9
)
.setField('testfuncsrc', JT.createSequence(
    JT.a_print('hello '),
    JT.a_print('world '),
    JT.ls().fieldLoop(
        'testarray',
        JT.a_tell(inventor.dbref, '%v ')
    )
))
.setField('testfunc', JT.do('testfuncsrc'));
//.setField('testfunc', JT.a_strcheck('', '', 8, '%#', '%#'));
/*inventor.init().setField('testfunc', JT.a_execute(JT.createSequence(
    JT.a_print('hello '),
    JT.a_print('world')
)));*/
/*inventor.init().setField('testfunc',
    JT.a_print('hello ','world')
);*/
//JT.output(
    //JT.a_execute(
        /*JT.a_getfield(
            inventor.dbref,
            'testfunc'
        )*/
        //JT.a_print('hello ','world')
    //)
//    JT.a_print('hello ','world')
//    , testContext
//);
smartphone.outputField(testContext, 'testfunc');
/*console.log(
    smartphone._compileField(testContext, 'testfuncsrc') + '%;' +
    smartphone._compileField(testContext, 'testfunc')
);*/

//

const engagementCore = JT.registerThing(
    'engagement core', 29979, inventor, gameCodeRoom
);

const stalemateCore = JT.registerThing(
    'stalemate core', 29980, inventor, gameCodeRoom
);

const numberCore = JT.registerThing(
    'number core', 29978, inventor, gameCodeRoom
);

numberCore.init()
// Altitude 3 (index 2) is in the cons
.registerArray('incons', true,
    0, 0, 1, 0, 0
)
// Power effect per altitude
.registerArray('power', true,
    -5, -4, -3, -2, -1
)
// Power given to launched missile at altitude
.registerArray('firingbonus', true,
    2, 4, 6, 8, 10
)
// Altitude as text
.registerArray('designatedaltitude', true,
    "5,000 feet",
    "20,000 feet",
    "35,000 feet",
    "50,000 feet",
    "65,000 feet"
)
// The index of the altitude used for some calculation
// MAY BE UNNECESSARY NOW
.setField('altituderegister', 0)
// Power given to missile from owner for each turn not-cold
.setConstant('attackercrankpower', 1)
// Base power given to launched missile
.setConstant('missilebasepower', 2)
// Negative numbers indicate the Scramble Stage
.setField('turncount', 2)
.setConstant('engagementturn', 4)
.setConstant('stalemateturn', 15)
.setConstant('mergeturn', 25)
.setField('turnsremaining', JT.a_sub(
    JT.get('mergeturn'),
    JT.get('turncount')
))
// The dbref of the engagement core or stalemate core, based on stage
.setField('combatcoredbref', JT.a_if(
    JT.a_lt(
        JT.get('turncount'),
        JT.get('stalemateturn')
    ),
    engagementCore.dbref,
    stalemateCore.dbref
));

// ENGAGEMENT CORE
// ...

// STALEMATE CORE
// ...

JT.finish(false, false);
