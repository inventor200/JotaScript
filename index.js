const JT = require("./jotascript").createBridge();

const inventor = JT.registerPlayer('inventor', 29923);
const gameCodeRoom = JT.registerRoom('Game Code Room', 29976, inventor);

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
.registerArray('in cons', true,
    0, 0, 1, 0, 0
)
// Power effect per altitude
.registerArray('power', true,
    -5, -4, -3, -2, -1
)
// Power given to launched missile at altitude
.registerArray('firing bonus', true,
    2, 4, 6, 8, 10
)
// Altitude as text
.registerArray('designated altitude', true,
    "5,000 feet",
    "20,000 feet",
    "35,000 feet",
    "50,000 feet",
    "65,000 feet"
)
// Power given to missile from owner for each turn not-cold
.setConstant('attacker crank power', 1)
// dbref returned if a player is missing
.setConstant('missing player dbref', -1)
// Base power given to launched missile
.setConstant('missile base power', 2)
// Negative numbers indicate the Scramble Stage
.setField('turn count', 2)
// Is it a turn for blue player (player 2)?
.setField('blue turn', 0)
.setConstant('engagement turn', 4)
.setConstant('stalemate turn', 15)
.setConstant('merge turn', 25)
.setField('turns remaining', JT.a_sub(
    JT.get('merge turn'),
    JT.get('turn count')
))
// The dbref of the engagement core or stalemate core, based on stage
.setField('combat core dbref', JT.a_if(
    JT.a_lt(
        JT.get('turn count'),
        JT.get('stalemate turn')
    ),
    engagementCore.dbref,
    stalemateCore.dbref
))
// The dbref of the red player
.setField('red player dbref', JT.get('missing player dbref'))
// The dbref of the blue player
.setField('blue player dbref', JT.get('missing player dbref'))
// The dbref of the player who has the turn
.setField('active player dbref',
    JT.a_if(JT.get('blue turn'),
        JT.get('blue player dbref'),
        JT.get('red player dbref')
    )
)
// The dbref of the player who is waiting
.setField('other player dbref',
    JT.a_if(JT.get('blue turn'),
        JT.get('red player dbref'),
        JT.get('blue player dbref')
    )
)
// Boolean for if the active player is holding the flight stick.
// Dropping the flight stick will cause the player to skip their turn.
.setField('active player is here',
    JT.a_eq(JT.get('active player dbref'), JT.get('missing player dbref'))
)
// Boolean for if the other player is holding the flight stick
.setField('other player is here',
    JT.a_eq(JT.get('other player dbref'), JT.get('missing player dbref'))
)
// Chooses to present the current turn, or skip it
// (depending on if both players are accounted for).
// If both players are unaccounted for, then just wait
// for someone to take the flight stick first.
.setField('present turn', JT.createSequence(
    JT.a_if(JT.get('blue turn'),
        JT.a_null(),
        JT.a_switch(JT.get('turns remaining'),
            JT.get('stalemate turn'), JT.do('show stalemate message'),
            JT.get('merge turn'), JT.do('start merge'),
            JT.a_null()
        )
    ),
    JT.a_if(JT.a_eq(
            JT.get('active player is here'),
            JT.get('other player is here')
        ),
        JT.do('present active player turn'),
        JT.do('skip turn')
    )
))
// Prints the stalemate message
.setField('show stalemate message', JT.createSequence(
    JT.a_tell(JT.get('red player dbref'), JT.get('stalemate message')),
    JT.a_tell(JT.get('blue player dbref'), JT.get('stalemate message'))
))
// Builds the message shown during stalemate
.setConstant('stalemate message',
    "You are not within visual range of your enemy. Time is running out!"
)
// Builds the text shown to the currently-active player
.setField('active player prompt',
    JT.a_print("It is your turn!")
)
// Send the turn text to both players
.setField('present active player turn', JT.createSequence(
    JT.a_tell(JT.get('active player dbref'),
        JT.get('active player prompt')
    ),
    JT.a_tell(JT.get('other player dbref'),
        JT.a_print("It is ", JT.a_shortname('other player dbref'), "'s turn!")
    )
))
// Inform the other player the their opponent is unaccounted for,
// and skip the current turn.
.setField('skip turn', JT.createSequence(
    JT.a_tell(JT.get('other player dbref'),
        JT.a_print(JT.a_shortname('other player dbref'),
            " seems to have either ejected, died, or blacked out, ",
            "and is skipping this turn!"
        )
    ),
    JT.do('progress turn')
))
// Move from red's turn to blue's turn, or
// from blue's turn to advancing the game state,
// and returning to red's turn.
.setField('progress turn', JT.createSequence(
    JT.set('blue turn', JT.a_not(JT.get('blue turn'))),
    JT.a_if(JT.get('red turn'),
        JT.do('complete turn'),
        JT.a_null()
    ),
    JT.do('present turn')
))
// Advance the game state, and send results to both players
.setField('complete turn', JT.createSequence(
    JT.a_tell(JT.get('red player dbref'), "Progressing turn!"),
    JT.a_tell(JT.get('blue player dbref'), "Progressing turn!")
));

// ENGAGEMENT CORE
// ...

// STALEMATE CORE
// ...

//JT.finish(false, false);
JT.finish();
