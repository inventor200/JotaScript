const JT = require("./jotascript").createBridge();
JT.networkStart();

const inventor = JT.registerPlayer('inventor', 29923);
const apartment = JT.registerRoom('Apartment', 29924, inventor);
const smartphone = JT.registerThing('smartphone', 29926, inventor, apartment);

const testContext = JT.createContext(inventor, inventor);

//const innerField = JT.a_switch(7, 7, 4, "wut");
//const field = JT.a_switch(innerField, 4, "foo%cbar", "bar");

//JT.postLog(field);
//JT.postLog(JT.output(field));
//JT.output([innerField, field]);
//JT.postLog(JT.output(innerField));
//JT.output(JT.a_switch(JT.a_print('a', 'b'), 'ab', 'yes', 'no'));

const booTest = JT.a_strloop(
    'hello world', 'x', JT.a_switch('%x', 'l', JT.a_print('Boo! '), '')
);
JT.output(booTest);
JT.postLog(
    booTest.compile(testContext, true)
);

const outerReferenceTest = JT.a_let('foo', '%{bar}!',
    JT.a_countloop(10, 'bar',
        JT.a_print('%{foo}', ' ', '%{bar}')
    )
);
JT.output(outerReferenceTest);
JT.postLog(
    outerReferenceTest.compile(testContext, true)
);

const mixedSubstitutionTest = JT.a_let('foo', JT.a_print('Heck'),
    JT.a_print('%{foo} yeah!')
);
JT.output(mixedSubstitutionTest);
JT.postLog(
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
/*JT.postLog(
    smartphone._compileField(testContext, 'testfuncsrc') + '%;' +
    smartphone._compileField(testContext, 'testfunc')
);*/

JT.networkFinish()