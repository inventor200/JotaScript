const prompt = require('prompt-sync')({sigint: true});

const nowheredbref = -3;

function convertData(obj) {
    if (obj === null || obj === undefined) {
        return "";
    }
    if (obj.isProgram) return obj;
    if (obj.isSequence) return obj;
    const dataType = typeof obj;
    if (dataType === 'number') {
        return obj;
    }
    if (dataType === 'string') {
        return preferNumber(obj);
    }
    if (dataType === 'boolean') {
        return obj === true ? 1 : 0;
    }
    if (Array.isArray(obj)) {
        throw new Error("Use a Sequence instead of an array");
    }
    throw new Error("Unsupported data type: " + dataType);
}

function preferNumber(obj) {
    const dataType = typeof obj;
    if (dataType === 'number') return obj;
    if (dataType === 'string') {
        if (obj.indexOf(' ') > -1 || obj.indexOf('%') > -1) {
            return obj; // DO NOT sacrifice spaces!!
        }
        const parsed = parseInt(obj);
        if (!isNaN(parsed)) return parsed;
    }
    return obj;
}

function forceNumber(obj) {
    const converted = preferNumber(obj);
    if ((typeof converted) != 'number') {
        throw new Error("Not a number: " + obj);
    }
    return converted;
}

function isBool(obj) {
    if (obj == 0) return true;
    if (obj == 1) return true;
    return false;
}

function forceBool(obj) {
    const converted = forceNumber(obj);
    if (converted < 0 || converted > 1) {
        throw new Error("Not a boolean: " + obj);
    }
    return converted;
}

function reduceData(context, obj) {
    if (arguments.length < 2) {
        throw new Error("Possible malformed reduceData()");
    }
    let converted = convertData(obj);
    while (converted.isProgram) {
        converted = converted.execute(context);
        if (converted === undefined || converted === null) {
            converted = "";
        }
    }
    return converted;
}

function reduceArg(context, obj) {
    if (arguments.length < 2) {
        throw new Error("Possible malformed reduceArg()");
    }
    if ((typeof obj) === 'string') {
        return context.bridge.processSubstitutions(
            context, obj
        );
    }
    return reduceData(context, obj);
}

function toArgArray(context, args) {
    let argArr = args;
    if (!Array.isArray(argArr)) {
        argArr = [args];
    }
    const processedArr = [];
    for (let i = 0; i < argArr.length; i++) {
        let item = argArr[i];
        processedArr.push(item);
    }
    return processedArr;
}

function filterExecutable(context, line) {
    // Sometimes a program returns nothing at all,
    // but the system needs to verify that no program
    // layers must be unpacked.
    if (line === undefined) return "";

    if (Array.isArray(line) || (line.isSequence && !line.registeredInField)) {
        throw new Error("Chained inner executions are forbidden.");
    }
    if ((typeof line) === 'string') {
        if (line.startsWith('@')) {
            context.bridge.throwTextCompilationNotImplemented();
        }
    }
    return convertData(line);
}

function unpackSequence(context, seq) {
    let unpacked = [];
    if (!seq.isSequence) {
        if (Array.isArray(seq)) {
            unpacked = seq;
        }
        else {
            unpacked = [seq];
        }
    }
    else {
        for (let i = 0; i < seq.programs.length; i++) {
            unpacked.push(seq.programs[i]);
        }
    }

    return toArgArray(context, unpacked);
}

function enforceDBRef(objOrDBRef) {
    if (objOrDBRef === undefined || objOrDBRef === null) {
        throw new Error("null dbref outlined");
    }
    const type = typeof objOrDBRef;
    if (type === 'number') return objOrDBRef;
    if (type === 'string') return forceNumber(objOrDBRef);
    if (objOrDBRef.isProgram) return objOrDBRef;
    if (objOrDBRef.dbref != undefined) return objOrDBRef.dbref;
    throw new Error("Bad dbref outline type: " + objOrDBRef);
}

function isStaticArg(arg, ignoredSubstitutions=[]) {
    const converted = convertData(arg);
    const dataType = typeof converted;
    if (dataType === 'number') return true;
    if (dataType === 'string') {
        // Remove the ignored subs, so we don't match them.
        let searchSpace = converted;
        if (ignoredSubstitutions.length > 0) {
            for (let i = 0; i < ignoredSubstitutions.length; i++) {
                searchSpace = doFullReplacement(
                    searchSpace,
                    ignoredSubstitutions[i],
                    '', true
                );
            }
        }
        const varyingExp = /(?:%[^{\s](?:$|\s)|%{[^\s}]+})/gi;
        const matchesStatic = !searchSpace.match(varyingExp);
        //console.log(converted + ' -> ' + matchesStatic);
        return matchesStatic;
    }

    // If the program is not piped into evaluationStatic() upon
    // creation, then it probably has no return, and will not
    // allow simplification. In this case, we NEED TO AVOID
    // the branch of this if-statement, because it will
    // otherwise clear the no-return status and eliminate data.
    if (arg.isProgram && !arg.doNotOptimize) {
        if (ignoredSubstitutions.length > 0) {
            // If we are being told to ignore certain substitution keys
            // this time around, then we need to re-evaluate.
            arg.evaluationStatic(arg.specializedDeterminer, ignoredSubstitutions);
        }
        return arg.isStatic;
    }
    return false;
}

// JotaCode enforces all lower-case spelling for programs, flags, and fields.
function enforceFieldNameCapitalization(fieldName) {
    const spaceRegEx = /\s/g;
    return String(fieldName).trim().replace(spaceRegEx, '').toLowerCase();
}

function compileContent(context, content, skipQuotes=false) {
    const reduced = convertData(content);
    if (reduced.isProgram || reduced.isSequence) {
        return String(reduced.compile(context));
    }
    if ((typeof reduced) === 'string' && !skipQuotes) {
        return '"' + reduced + '"';
    }
    return reduced;
}

function getSubstitutionKey(key) {
    if (!key.startsWith('%')) {
        key = '%' + key;
    }
    if (key.length > 2) {
        key = '%{' + key.substring(1) + '}';
    }
    return key;
}

// We need to have control over replacement rules, but we cannot
// process user input as accidental regex.
function doFullReplacement(str, goal, replacement, ignoreCase) {
    let searchStr = ignoreCase ? str.toLowerCase() : str;
    let searchGoal = ignoreCase ? goal.toLowerCase() : goal;
    let foundIndex = searchStr.indexOf(searchGoal);
    while (foundIndex > -1) {
        let before = str.substring(0, foundIndex);
        let after = str.substring(foundIndex + searchGoal.length, str.length);
        str = before + replacement + after;
        searchStr = ignoreCase ? str.toLowerCase() : str;
        foundIndex = searchStr.indexOf(searchGoal);
    }
    return str;
}

class Sequence {
    constructor(programs) {
        this.programs = programs;
        this.isSequence = true;
        this.registeredInField = false;
    }

    compile(context) {
        let res = '{ ';
        for (let i = 0; i < this.programs.length; i++) {
            res += ',';
            res += compileContent(context, this.programs[i]);
        }
        return res + ' }';
    }
}

// Multi-instruction access is not possible in JotaCode,
// so what we can do is pre-initialize our arrays beforehand,
// and distribute them as @switch() statements during compile.
//
// This assumes a static array, of course, which is more compact.
// If we want to modify elements on the fly, we will need something
// more complex. However, to not be a menace on the MUD, it's
// best to keep arrays static whenever possible, because the non-
// static injections are a lot more involved.
class JotaArray {
    constructor(parent, arrayName, isStatic, elements) {
        this.arrayName = arrayName;
        this.parent = parent;
        this.isStatic = isStatic;
        this.elements = elements;

        if (!isStatic) {
            for (let i = 0; i < elements.length; i++) {
                parent._setField(
                    this.getIndexFieldName(i), elements[i]
                );
            }
        }
    }

    getIndexFieldName(i) {
        return this.arrayName + 'index' + String(i);
    }

    createGetter(indexProgram) {
        // Dynamic access
        if (indexProgram.isProgram) {
            if (this.isStatic) {
                const switchContents = [];
                switchContents.push(
                    indexProgram
                );
                for (let i = 1; i < this.elements.length; i++) {
                    switchContents.push(i);
                    switchContents.push(this.elements[i]);
                }
                switchContents.push(this.elements[0]);
                
                return this.parent.bridge.a_switch(...switchContents);
            }

            return this.parent.getField(
                this.createIndexedField(indexProgram)
            );
        }

        // Baked access
        //
        // This index will never change, so we can safely just
        // return the value it would access.
        const index = forceNumber(indexProgram);
        if (this.isStatic) {
            return this.elements[index];
        }

        return this.parent.getField(
            this.arrayName + 'index' + index
        );
    }

    createIndexedField(indexProgram) {
        const wrappedIndex = this.parent.bridge.a_execute(indexProgram);
        return this.parent.bridge.a_print(
            this.arrayName + "index",
            wrappedIndex
        );
    }

    createSetter(indexProgram, value) {
        return this.parent.setField(
            this.createIndexedField(indexProgram), value
        );
    }

    // I cannot believe this worked.
    createIterator(iterProgram) {
        if (this.isStatic) {
            // Create a fake field loop, ahahahaha
            const indexSubst = this.arrayName + 'indexiter';
            return this.parent.bridge.a_countloop(
                this.elements.length,
                indexSubst,
                // Okay, something really important...
                // Substitutions defined in inner levels cannot
                // be referred to in outer levels
                this.parent.bridge.a_let(
                    'f', 'fakearrayiterfield',
                    'v', this.createGetter(
                        this.parent.bridge.a_substitute(
                            '%{' + indexSubst + '}'
                        )
                    ),
                    this.parent.bridge.a_substitute(iterProgram)
                )
            );
        }

        return this.parent.bridge.a_fieldloop(
            this.parent.dbref, this.arrayName + 'index', iterProgram
        );
    }
}

class Program {
    constructor(name, data, ...args) {
        this.isProgram = true;
        this.name = name;
        this.data = data;
        this.args = args;
        this.depth = 0;
        this.deepens = false;
        this.isStatic = false;
        this.doNotOptimize = true;
        this.specializedDeterminer = undefined;
        this.specializedTransformer = undefined;
    }

    // Usually piped off the end of loop declarations
    deepenContext() {
        this.deepens = true;
        this.adjustDepth(0);
        return this;
    }

    // Usually piped off the end of loop declarations
    evaluationStatic(specializedDeterminer, ignoredSubstitutions=[]) {
        this.doNotOptimize = false;
        this.specializedDeterminer = specializedDeterminer;
        const argArray = this.simplifyArgArray(this.args);
        this.isStatic = true;
        for (let i = 0; i < argArray.length; i++) {
            const item = argArray[i];
            if (!isStaticArg(argArray[i], ignoredSubstitutions)) {
                if (specializedDeterminer) {
                    // Do we have a specialized backup plan?
                    const suggestedTransformer = specializedDeterminer({
                        args: argArray,
                        ignoredSubstitutions: ignoredSubstitutions
                    });
                    if (suggestedTransformer != undefined) {
                        this.specializedTransformer = suggestedTransformer;
                        return this;
                    }
                }
                this.isStatic = false;
                return this;
            }
        }
        return this;
    }

    adjustDepth(rootDepth) {
        this.depth = rootDepth + (this.deepens ? 1 : 0);

        const argArray = this.simplifyArgArray(this.args);
        for (let i = 0; i < argArray.length; i++) {
            const item = argArray[i];
            if (!item.isProgram) continue;
            item.adjustDepth(this.depth);
        }
    }

    execute(context) {
        return this.data(
            context.bridge.deepenContext(context, this.depth),
            ...this.args
        );
    }

    compile(context, skipQuotes=false) {
        const argArray = this.simplifyArgArray(this.args);
        if (this.isStatic) {
            if (this.specializedTransformer != undefined) {
                return compileContent(
                    context,
                    this.specializedTransformer,
                    skipQuotes
                );
            }
            return compileContent(
                context,
                this.execute(context),
                skipQuotes
            );
        }
        let res = this.name + '(';
        for (let i = 0; i < argArray.length; i++) {
            if (i > 0) res += ',';
            res += compileContent(
                context,
                argArray[i]
            );
        }
        return res + ')';
    }

    simplifyArgArray(argArray) {
        while (Array.isArray(argArray[0])) {
            argArray = argArray[0];
        }
        return argArray;
    }
}

class DatabaseObject {
    constructor(bridge, objectType, vocab, dbref) {
        this.bridge = bridge;
        this.objectType = objectType;
        this.vocab = vocab;
        this.dbref = dbref;
        this.flags = [];
        this.constants = [];
        this.fields = [];
        this.arrays = [];
        this.customActions = [];
        this.isObject = false;
        this.isPlayer = false;
        this.isRoom = false;
        this.isExit = false;
        this.initializedSafely = false;
        this.arraysAllowed = true;
    }

    /**
     * For internal use only
     * @private
     */
    matchesName(str) {
        const names = this.vocab.split(';');
        for (let i = 0; i < names.length; i++) {
            if (names[i] === str) return true;
        }
        return false;
    }

    /**
     * For internal use only
     * @private
     */
    _getShortName() {
        return this.vocab.split(';')[0];
    }

    /**
     * For internal use only
     * @private
     */
    _setFlag(flagName, state) {
        flagName = enforceFieldNameCapitalization(flagName);
        const index = this.flags.indexOf(flagName);
        if (state) {
            if (index > -1) return;
            this.flags.push(flagName);
        }
        else {
            if (index === -1) return;
            this.flags.splice(index, 1);
        }
    }

    /**
     * For internal use only
     * @private
     */
    _getFlag(flagName) {
        flagName = enforceFieldNameCapitalization(flagName);
        return this.flags.indexOf(flagName) > -1;
    }

    /**
     * For internal use only
     * @private
     */
    throwOverwriteConstantError(fieldName) {
        throw new Error(
            "Cannot set a new value to constant \"" + fieldName +
            "\" on " + this._getShortName() + "!"
        );
    }

    /**
     * For internal use only
     * @private
     */
    _setConstant(fieldName, value) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        for (let i = 0; i < this.constants.length; i++) {
            const field = this.constants[i];
            if (field.fieldName === fieldName) {
                throwOverwriteConstantError(fieldName);
            }
        }
        for (let i = 0; i < this.fields.length; i++) {
            const field = this.fields[i];
            if (field.fieldName === fieldName) {
                throwOverwriteConstantError(fieldName);
            }
        }
        this.constants.push(new ObjectField(this, fieldName, value));
    }

    /**
     * For internal use only
     * @private
     */
    _setField(fieldName, value) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        for (let i = 0; i < this.constants.length; i++) {
            const field = this.constants[i];
            if (field.fieldName === fieldName) {
                throwOverwriteConstantError(fieldName);
            }
        }
        for (let i = 0; i < this.fields.length; i++) {
            const field = this.fields[i];
            if (field.fieldName === fieldName) {
                field.value = value;
                return;
            }
        }
        this.fields.push(new ObjectField(this, fieldName, value));
    }

    /**
     * For internal use only
     * @private
     */
    _getField(fieldName) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        for (let i = 0; i < this.fields.length; i++) {
            const field = this.fields[i];
            if (field.fieldName === fieldName) {
                return field.value;
            }
        }

        return "";
    }

    /**
     * For internal use only
     * @private
     */
    _executeField(context, fieldName) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        for (let i = 0; i < this.fields.length; i++) {
            const field = this.fields[i];
            if (field.fieldName === fieldName) {
                return field.getOutput(context);
            }
        }

        return "";
    }

    /**
     * For internal use only
     * @private
     */
    _compileField(context, fieldName) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        for (let i = 0; i < this.fields.length; i++) {
            const field = this.fields[i];
            if (field.fieldName === fieldName) {
                return field.compile(context);
            }
        }
    }

    /**
     * For internal use only
     * @private
     */
    _getArrayByName(arrayName) {
        arrayName = enforceFieldNameCapitalization(arrayName);
        for (let i = 0; i < this.arrays.length; i++) {
            const arr = this.arrays[i];
            if (arr.arrayName === arrayName) {
                return arr;
            }
        }

        return undefined;
    }

    /**
     * For internal use only
     * @private
     */
    checkInitState(propertyName, settingField=false) {
        if (!this.initializedSafely) {
            console.log(
                'WARNING: ' + this._getShortName() +
                ' has not initialized safely yet! ' +
                'You should use this instead:\n\n    ' +
                'objectName.init().' +
                (settingField ?
                    'setField(' + propertyName + ', startingValue)'
                    :
                    'setFlag(' + propertyName + ', startingState)'
                ) + '\n'
            );
        }
    }

    /**
     * For internal use only
     * @private
     */
    showMissingArrayError(arrayName) {
        throw new Error(
            "No array '" + arrayName + "' on " +
            this._getShortName()
        );
    }

    /**
     * For internal use only
     * @private
     */
    passesLock(agent) {
        //TODO: Implement lock rules
        return true;
    }

    /**
     * For internal use only
     * @private
     */
    doFieldPair(context, pairName) {
        pairName = enforceFieldNameCapitalization(pairName);

        const hasOverride = this.doPairHalf(
            context, this._getField(pairName), false
        );
        this.doPairHalf(context, this._getField('o' + pairName), true);

        return hasOverride;
    }

    /**
     * For internal use only
     * @private
     */
    doPairHalf(context, fieldObj, isExternal) {
        if (!fieldObj || String(fieldObj).length === 0) return false;

        if (fieldObj.isSequence) {
            for (let i = 0; i < fieldObj.programs.length; i++) {
                this.doSinglePairHalf(
                    context, fieldObj.programs[i], isExternal
                );
            }
            return true;
        }
        this.doSinglePairHalf(context, fieldObj, isExternal);
        return true;
    }

    /**
     * For internal use only
     * @private
     */
    doSinglePairHalf(context, fieldObj, isExternal) {
        const output = fieldObj.getOutput(context);
        if (String(output).length === "") return;

        if (isExternal) {
            let agentRoom = context.agent.location;
            while (agentRoom && !agentRoom.isRoom) {
                agentRoom = agentRoom.location;
            }

            for (let i = 0; i < this.bridge.registeredObjects.length; i++) {
                const obj = this.bridge.registeredObjects[i];
                if (!obj.isPlayer) continue;
                if (obj === context.agent) continue;
                obj.processMessage(output);
            }
        }
        else {
            context.agent.processMessage(output);
        }
    }

    // Object-oriented alternatives to program-building:
    registerArray(arrayName) {
        throw new Error(
            "Cannot register array '" + arrayName + "' on " +
            this._getShortName() + " outside of init() pipeline!"
        );
    }

    setConstant(fieldName) {
        throw new Error(
            "Cannot set constant '" + fieldName + "' on " +
            this._getShortName() + " outside of init() pipeline!"
        );
    }

    registerAction(vocab) {
        throw new Error(
            "Cannot set action '" + vocab + "' on " +
            this._getShortName() + " outside of init() pipeline!"
        );
    }

    getArray(arrayName, indexProgram) {
        arrayName = enforceFieldNameCapitalization(arrayName);
        const currentArray = this._getArrayByName(arrayName);
        if (currentArray === undefined) {
            this.showMissingArrayError(arrayName);
        }

        return currentArray.createGetter(indexProgram);
    }

    setArray(arrayName, indexProgram, value) {
        arrayName = enforceFieldNameCapitalization(arrayName);
        const currentArray = this._getArrayByName(arrayName);
        if (currentArray === undefined) {
            this.showMissingArrayError(arrayName);
        }
        if (currentArray.isStatic) {
            throw new Error(
                "Array '" + arrayName + "' on " +
                this._getShortName() + ' is STATIC, and cannot be modified!'
            );
        }
        return currentArray.createSetter(indexProgram, value);
    }

    getFlag(flagName) {
        flagName = enforceFieldNameCapitalization(flagName);
        return this.bridge.a_testflag(this.dbref, flagName);
    }

    setFlag(flagName, state) {
        flagName = enforceFieldNameCapitalization(flagName);
        this.checkInitState(flagName, false);
        if (state === undefined) {
            return this.bridge.a_setflag(this.dbref, flagName);
        }
        return this.bridge.a_setflag(this.dbref,
            (state ? '' : '!') + flagName
        );
    }

    cloneField(fieldName) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        return this.bridge.a_getfield(this.dbref, fieldName);
    }

    getField(fieldName) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        // If it's a constant, then just send the value directly.
        for (let i = 0; i < this.constants.length; i++) {
            const field = this.constants[i];
            if (field.fieldName === fieldName) {
                return field.value;
            }
        }
        // Otherwise send an execute-wrapped getfield program.
        return this.bridge.a_execute(this.cloneField(fieldName));
    }

    setField(fieldName, value) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        this.checkInitState(fieldName, true);
        return this.bridge.a_setfield(this.dbref, fieldName, value);
    }

    // Shorthand, which allows the dev to think about this in a 
    // functional context, and not in a copy context.
    do(fieldName) {
        return this.getField(fieldName);
    }

    doFor(fieldName, iterations) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        const field = this._getField(fieldName);
        if (field === "") {
            return "";
        }
        return this.bridge.a_countloop(
            iterations, 'repeatforindex',
            this.cloneField(fieldName)
        );
    }

    getLocation() {
        return this.bridge.a_location(this.dbref);
    }

    getRoom() {
        return this.bridge.a_toploc(this.dbref);
    }

    moveTo(destination) {
        return this.bridge.a_move(this.dbref, enforceDBRef(destination));
    }

    getExit(destination) {
        throw new Error("Not a room");
    }

    setDest(destination) {
        throw new Error("Not an exit");
    }

    getName() {
        return this.bridge.a_name(this.dbref);
    }

    getShortName() {
        return this.bridge.a_shortname(this.dbref);
    }

    call(fieldName) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        return this.bridge.a_call(this.dbref, fieldName);
    }

    contentsLoop(substitutionString, iterProgram) {
        return this.bridge.a_contentsloop(this.dbref, substitutionString, iterProgram);
    }

    fieldLoop(fieldPrefix, iterProgram) {
        fieldPrefix = enforceFieldNameCapitalization(fieldPrefix);
        const possibleArray = this._getArrayByName(fieldPrefix);
        if (possibleArray) {
            return possibleArray.createIterator(iterProgram);
        }
        return this.bridge.a_fieldloop(this.dbref, fieldPrefix, iterProgram);
    }

    /**
     * Open an initializer pipeline for this object.
     * We need to do this to make sure we are setting direct
     * initialized values, and not just programs that will do
     * this during execution time.
     */
    init() {
        this.initializedSafely = true;
        return new ObjectInitializer(this);
    }

    // For debugging
    outputField(context, fieldName) {
        fieldName = enforceFieldNameCapitalization(fieldName);
        for (let i = 0; i < this.fields.length; i++) {
            const field = this.fields[i];
            if (field.fieldName === fieldName) {
                context.agent.processMessage(
                    this.bridge.processSubstitutions(
                        context, field.getOutput(context)
                    )
                );
                return;
            }
        }
    }

    finishAction() {
        throw new Error(
            "Cannot finish action outside of an action's init() pipe!"
        );
    }
}

class ObjectInitializer {
    constructor(parent) {
        this.parent = parent;
        this.parent.bridge.localScope = this.parent;
        this.parentInit = undefined;
        this.isActionInit = false;
    }

    setField(fieldName, value) {
        this.parent.arraysAllowed = false;
        fieldName = enforceFieldNameCapitalization(fieldName);
        this.parent._setField(fieldName, value);
        return this;
    }

    setConstant(fieldName, value) {
        this.parent.arraysAllowed = false;
        fieldName = enforceFieldNameCapitalization(fieldName);
        this.parent._setConstant(fieldName, value);
        return this;
    }

    setFlag(flagName, state) {
        this.parent.arraysAllowed = false;
        flagName = enforceFieldNameCapitalization(flagName);
        if (state === undefined) {
            if (flagName.startsWith('!')) {
                flagName = flagName.substring(1);
                state = false;
            }
            else {
                state = true;
            }
        }
        this.parent._setFlag(flagName, state);
        return this;
    }

    registerArray(arrayName, isStatic, ...elements) {
        if (!this.parent.arraysAllowed) {
            throw new Error(
                "Arrays must be declared FIRST on " +
                this.parent._getShortName()
            );
        }
        arrayName = enforceFieldNameCapitalization(arrayName);
        const currentArray = this.parent._getArrayByName(arrayName);
        const arrElements = [...elements];
        if (currentArray) {
            throw new Error(
                "Array '" + arrayName + "' already registered on " +
                this.parent._getShortName()
            );
        }
        this.parent.arrays.push(new JotaArray(
            this.parent, arrayName, isStatic, arrElements
        ));
        return this;
    }

    registerAction(vocab, dbref) {
        const customAction = new Exit(
            this.parent.bridge,
            vocab, dbref,
            this.parent.owner, this.parent
        );
        this.parent.customActions.push(customAction);
        const nestedInit = customAction.init();
        nestedInit.parentInit = this;
        nestedInit.isActionInit = true;
        return nestedInit;
    }

    setDest(destination) {
        this.parent._setField('link', enforceDBRef(destination));
        return this;
    }

    finishAction() {
        if (!this.isActionInit) {
            throw new Error(
                "Cannot finish action outside of an action's init() pipe!"
            );
        }
        this.parent.bridge.localScope = this.parentInit.parent;
        return this.parentInit
    }
}

class Ownable extends DatabaseObject {
    constructor(bridge, objectType, vocab, dbref, owner) {
        super(bridge, objectType, vocab, dbref);
        this.owner = owner;
        this.hasPOV = true;
    }

    processMessage(msg) {
        if (!this.hasPOV) return;
        /*msg = String(convertData(msg)).replace(
            new RegExp('%c', 'gi'), '\n'
        ).replace(
            new RegExp('%%', 'g'), '%'
        );*/
        console.log('[' + this._getShortName() + ' POV] ' + msg);
    }
}

class Locatable extends Ownable {
    constructor(bridge, objectType, vocab, dbref, owner, location=null) {
        super(bridge, objectType, vocab, dbref, owner);
        this.location = location;
    }
}

class Thing extends Locatable {
    constructor(bridge, vocab, dbref, owner, location=null) {
        super(bridge, 4, vocab, dbref, owner, location);
        this.owner = owner;
        this.isObject = true;
        this._setField('eat', "That would not be a safe idea...");
        this._setField('oeat', "hungrily eyes the " + this._getShortName() + "...");
    }
}

class Exit extends Locatable {
    constructor(bridge, vocab, dbref, owner, location=null) {
        super(bridge, 3, vocab, dbref, owner, location);
        this.isExit = true;
        this._setField('link', nowheredbref);
    }

    // Object-oriented alternatives to program-building:
    setDest(destination) {
        return this.bridge.a_setdest(this.dbref, enforceDBRef(destination));
    }

    createDest(destination) {
        this._setField('link', enforceDBRef(destination));
    }

    goesNowhere() {
        const field = this._getField('link');
        return (
            field && field.value &&
            !field.value.isProgram && field.value === nowheredbref
        );
    }
}

class Player extends Locatable {
    constructor(bridge, vocab, dbref, location=null) {
        super(bridge, 2, vocab, dbref, null, location);
        this.owner = this;
        this.isObject = true;
        this.isPlayer = true;
    }
}

class Room extends Ownable {
    constructor(bridge, vocab, owner, dbref) {
        super(bridge, 1, vocab, owner, dbref);
        this.isRoom = true;
    }

    _getShortName() {
        return this.vocab;
    }

    // Object-oriented alternatives to program-building:
    getLocation() {
        return nowheredbref;
    }

    getRoom() {
        return this.dbref;
    }

    moveTo(destination) {
        throw new Error("Cannot move room");
    }

    getExitByName(exitName) {
        return this.bridge.a_exit(this.dbref, exitName);
    }
}

class ObjectField {
    constructor(parent, fieldName, startingValue="") {
        this.parent = parent;
        if (fieldName === 'desc') fieldName = 'description';
        if (fieldName === 'succ') fieldName = 'success';
        if (fieldName === 'osucc') fieldName = 'osuccess';
        this.fieldName = fieldName;
        this.value = startingValue;
        if (this.value.isSequence) {
            this.value.registeredInField = true;
        }
    }

    getOutput(context) {
        if (this.value === null || this.value === undefined) return;
        if (Array.isArray(this.value)) {
            throw new Error("Use a Sequence instead of an array");
        }
        //console.log(this.value);
        if (this.value.isSequence) {
            let res = '';
            for (let i = 0; i < this.value.programs.length; i++) {
                res += this.getSingleOutput(context, this.value.programs[i]);
            }
        }
        else {
            return this.getSingleOutput(context, this.value);
        }
    }

    getSingleOutput(context, jotacode) {
        if (this.value === null || this.value === undefined) return;
        const definedProgram = jotacode.isProgram;
        while (jotacode.isProgram) {
            //console.log(jotacode);
            jotacode = (
                context.bridge.a_execute(jotacode)
            ).execute(context);
        }
        if (!jotacode.isProgram) {
            if ((typeof jotacode) === 'string' && !definedProgram) {
                jotacode = context.bridge.processSubstitutions(
                    context, jotacode
                );
            }
            jotacode = convertData(jotacode);
        }
        //console.log(jotacode);
        return String(jotacode);
    }

    compile(context) {
        let res = '';
        switch (this.fieldName) {
            case 'description':
                res = '@desc #' + String(this.parent.dbref) + '=';
                break;
            case 'success':
                res = '@succ #' + String(this.parent.dbref) + '=';
                break;
            case 'osuccess':
                res = '@osucc #' + String(this.parent.dbref) + '=';
                break;
            case 'fail':
                res = '@fail #' + String(this.parent.dbref) + '=';
                break;
            case 'ofail':
                res = '@ofail #' + String(this.parent.dbref) + '=';
                break;
            case 'drop':
                res = '@drop #' + String(this.parent.dbref) + '=';
                break;
            case 'odrop':
                res = '@odrop #' + String(this.parent.dbref) + '=';
                break;
            case 'lock':
                res = '@lock #' + String(this.parent.dbref) + '=';
                break;
            default:
                res = '@ofail #' + String(this.parent.dbref) +
                    '=' + this.fieldName + ':';
                break;
        }

        if (this.value.isSequence) {
            const segments = [];
            let containsPrograms = false;
            for (let i = 0; i < this.value.programs.length; i++) {
                const prog = this.compileSingle(
                    context, this.value.programs[i]
                );
                if (prog.startsWith('@')) {
                    containsPrograms = true;
                    segments.push(prog);
                }
                else if (segments.length > 0) {
                    const lastProg = segments[segments.length - 1];
                    if (lastProg.startsWith('@')) {
                        segments.push(prog);
                    }
                    else {
                        segments[segments.length - 1] =
                            String(lastProg) + String(prog);
                    }
                }
                else {
                    segments.push(prog);
                }
            }

            for (let i = 0; i < segments.length; i++) {
                const prog = segments[i];
                if (i > 0 && containsPrograms) {
                    res += ';';
                }

                let compiled = prog;

                if (!compiled.startsWith('@') && containsPrograms) {
                    compiled = '@print(' + '"' + compiled + '")';
                }

                res += compiled;
            }
        }
        else {
            res += this.compileSingle(context, this.value);
        }

        return res;
    }

    compileSingle(context, jotacode) {
        if (jotacode.isProgram) {
            return String(jotacode.compile(context, true));
        }
        return String(jotacode);
    }
}

class JotaBridge {
    constructor() {
        this.bridge = this;
        this.registeredObjects = [];
        this.registeredSubstitutions = [];

        this.adminPlayer = new Player(
            this, 'admin player', -100, null
        );
        this.registeredObjects.push(this.adminPlayer);

        this.nowhere = new Room(
            this, 'nowhere', nowheredbref, this.adminPlayer
        );
        this.registeredObjects.push(this.nowhere);
        this.adminPlayer.location = this.nowhere;

        this.outputItem = new Thing(
            this, 'output item', -150, this.adminPlayer, this.nowhere
        );
        this.registeredObjects.push(this.outputItem);
        this.outputItem._setField('run', "Hello world!");
        this.printMessages = [];
        this.localScope = null;
    }

    registerThing(vocab, dbref, owner, location=null) {
        const registree = new Thing(this, vocab, dbref, owner, location);
        this.registeredObjects.push(registree);
        return registree;
    }

    registerPlayer(vocab, dbref, location=null) {
        const registree = new Player(this, vocab, dbref, location);
        this.registeredObjects.push(registree);
        return registree;
    }

    registerExit(vocab, dbref, owner, location=null) {
        const registree = new Exit(this, vocab, dbref, owner, location);
        this.registeredObjects.push(registree);
        return registree;
    }

    registerRoom(vocab, dbref, owner) {
        const registree = new Room(this, vocab, dbref, owner);
        this.registeredObjects.push(registree);
        owner.location = registree;
        return registree;
    }

    createSequence(...programs) {
        return new Sequence(programs);
    }

    createContext(
        agent, object,
        exitArg0='', exitArg1='', exitArg2='', exitArg3=''
    ) {
        const certainReference = this;
        return {
            bridge: certainReference,
            agent: agent,
            object: object,
            exitArg0: String(exitArg0),
            exitArg1: String(exitArg1),
            exitArg2: String(exitArg2),
            exitArg3: String(exitArg3),
            exitArg0Lower: String(exitArg0).toLowerCase(),
            exitArg1Lower: String(exitArg1).toLowerCase(),
            exitArg2Lower: String(exitArg2).toLowerCase(),
            exitArg3Lower: String(exitArg3).toLowerCase(),
            depth: 0
        };
    }

    cloneContext(oldContext) {
        return {
            bridge: oldContext.bridge,
            agent: oldContext.agent,
            object: oldContext.object,
            exitArg0: oldContext.exitArg0,
            exitArg1: oldContext.exitArg1,
            exitArg2: oldContext.exitArg2,
            exitArg3: oldContext.exitArg3,
            exitArg0Lower: oldContext.exitArg0Lower,
            exitArg1Lower: oldContext.exitArg1Lower,
            exitArg2Lower: oldContext.exitArg2Lower,
            exitArg3Lower: oldContext.exitArg3Lower,
            depth: oldContext.depth
        };
    }

    deepenContext(oldContext, newDepth) {
        const newContext = this.cloneContext(oldContext);
        newContext.depth = newDepth;
        return newContext;
    }

    createTestContext() {
        return this.createContext(this.adminPlayer, this.outputItem);
    }

    checkLocalScope() {
        if (!this.localScope) {
            throw new Error("Not in init() mode before calling do(fieldName)!");
        }
    }

    // Shorthand for init() declarations
    ls() {
        this.checkLocalScope();
        return this.localScope;
    }

    // Shorthand for init() declarations
    self() {
        this.checkLocalScope();
        return this.localScope.dbref;
    }

    // Shorthand for init() declarations
    do(fieldName) {
        this.checkLocalScope();
        return this.localScope.do(fieldName);
    }

    // Shorthand for init() declarations
    get(fieldName) {
        this.checkLocalScope();
        return this.localScope.getField(fieldName);
    }

    // Shorthand for init() declarations
    set(fieldName, value) {
        this.checkLocalScope();
        return this.localScope.setField(fieldName, value);
    }

    // Shorthand for init() declarations
    eval(dstFieldName, srcFieldName) {
        this.checkLocalScope();
        return this.localScope.setField(dstFieldName,
            this.localScope.getField(srcFieldName)
        );
    }

    // Shorthand for init() declarations
    clone(dstFieldName, srcFieldName) {
        this.checkLocalScope();
        return this.localScope.setField(dstFieldName,
            this.localScope.cloneField(srcFieldName)
        );
    }

    // Shorthand for init() declarations
    flag(flagName) {
        this.checkLocalScope();
        return this.localScope.setFlag(flagName, undefined);
    }

    // Shorthand for init() declarations
    read(arrayName, indexProgram) {
        this.checkLocalScope();
        return this.localScope.getArray(arrayName, indexProgram);
    }

    // Shorthand for init() declarations
    write(arrayName, indexProgram, value) {
        this.checkLocalScope();
        return this.localScope.setArray(arrayName, indexProgram, value);
    }

    createSubstitutionPair(key, value) {
        return {
            key: key,
            value: value
        };
    }

    registerSubstitution(context, subsitutionPair) {
        subsitutionPair.key = getSubstitutionKey(subsitutionPair.key);
        subsitutionPair.depth = context.depth;
        this.registeredSubstitutions.push(subsitutionPair);
        return subsitutionPair;
    }

    retireSubstitution(subsitutionPair) {
        const index = this.registeredSubstitutions.indexOf(subsitutionPair);
        this.registeredSubstitutions.splice(index, 1);
    }

    processSubstitutions(context, str) {
        if (arguments.length < 2) {
            throw new Error("Possible malformed processSubstitutions()");
        }
        if ((typeof str) === 'string') {
            let oldStr;
            str = doFullReplacement(
                str, '%%', ':{percentchar}:', false
            );
            do {
                oldStr = str;

                // Handle default substitutions
                str = doFullReplacement(
                    str, '%#', context.agent.dbref, false
                );
                str = doFullReplacement(
                    str, '%!', context.object.dbref, false
                );
                str = doFullReplacement(
                    str, '%s',
                    'they (' +
                    context.agent._getShortName() +
                    ')', true
                );
                str = doFullReplacement(
                    str, '%n',
                    context.agent._getShortName(), true
                );
                str = doFullReplacement(
                    str, '%p',
                    'their (' +
                    context.agent._getShortName() +
                    ')', true
                );
                str = doFullReplacement(
                    str, '%a',
                    'theirs (' +
                    context.agent._getShortName() +
                    ')', true
                );
                str = doFullReplacement(
                    str, '%o',
                    'them (' +
                    context.agent._getShortName() +
                    ')', true
                );
                str = doFullReplacement(
                    str, '%r',
                    'themself (' +
                    context.agent._getShortName() +
                    ')', true
                );
                str = doFullReplacement(
                    str, '%l',
                    context.agent.location._getShortName(), true
                );
                str = doFullReplacement(
                    str, '%c', '\n', true
                );
                for (let i = 0; i < 4; i++) {
                    let upper;
                    let lower;
                    switch (i) {
                        default:
                        case 0:
                            upper = context.exitArg0;
                            lower = context.exitArg0Lower;
                            break;
                        case 1:
                            upper = context.exitArg1;
                            lower = context.exitArg1Lower;
                            break;
                        case 2:
                            upper = context.exitArg2;
                            lower = context.exitArg2Lower;
                            break;
                        case 3:
                            upper = context.exitArg3;
                            lower = context.exitArg3Lower;
                            break;
                    }
                    str = doFullReplacement(
                        str, '%' + String(i),
                        lower, false
                    );
                    str = doFullReplacement(
                        str, '%' + String(i + 4),
                        upper, false
                    );
                }

                //console.log("  " + str);
                //for (let i = this.registeredSubstitutions.length - 1; i >= 0; i--) {
                for (let i = 0; i < this.registeredSubstitutions.length; i++) {
                    const pair = this.registeredSubstitutions[i];
                    //console.log("\n" + pair.key + " -> " + pair.value);
                    //console.log("Pair: " + pair.depth + " < Context: " + context.depth);
                    if (pair.depth < context.depth) continue;
                    // Only allow a program to be a direct
                    // replacement if it's a perfect match.
                    // Also, if it's a perfect match, then there
                    // are no other replacements to process.
                    if (pair.value && pair.value.isProgram) {
                        const sample = String(str);
                        const keyIndex = sample.indexOf(pair.key);
                        // Exact match
                        if (sample === pair.key) {
                            return reduceData(context, pair.value);
                        }
                        // Does contain key
                        else if (keyIndex > -1) {
                            const before = str.substring(0, keyIndex);
                            const after = str.substring(keyIndex + pair.key.length);
                            if (keyIndex === 0) {
                                return this.a_print(
                                    pair.value,
                                    after
                                ).execute(context);
                            }
                            if (keyIndex + pair.key.length === str.length) {
                                return this.a_print(
                                    before,
                                    pair.value
                                ).execute(context);
                            }
                            return this.a_print(
                                before,
                                pair.value,
                                after
                            ).execute(context);
                        }
                    }

                    // Otherwise, do other replacements
                    str = doFullReplacement(
                        str, pair.key, pair.value, false
                    );
                }
            } while (str != oldStr);
            str = doFullReplacement(
                str, ':{percentchar}:', '%', false
            );
        }
        return convertData(str);
    }

    // For simple execution
    outputEach(programs, context=undefined) {
        if (!context) context = this.createTestContext();
        programs = toArgArray(context, programs);
        let res = '';
        for (let i = 0; i < programs.length; i++) {
            res += this.output(programs[i], context, false);
        }
        context.agent.processMessage(res);
    }

    output(programs, context=undefined, dumpMessagesAfter=true) {
        if (!context) context = this.createTestContext();
        this.outputItem._setField('run', programs);
        this.outputItem.owner = context.agent;
        const res = this.bridge.processSubstitutions(
            context, this.outputItem._executeField(context, 'run')
        );
        if (dumpMessagesAfter) {
            context.agent.processMessage(res);
        }
        else {
            return res;
        }
    }

    dbrefGet(dbref) {
        dbref = forceNumber(dbref);
        for (let i = 0; i < this.registeredObjects.length; i++) {
            const obj = this.registeredObjects[i];
            if (obj.dbref === dbref) return obj;
        }

        throw new Error("No dbref match: " + dbref);
    }

    throwWrongArgCount(programName, foundCount) {
        throw new Error(
            `${programName} has the wrong argument count: ${foundCount}`
        );
    }

    throwTextCompilationNotImplemented() {
        throw new Error("System does not yet support text compilation!");
    }

    wrapCompileJump(arg) {
        if (arg.isProgram) {
            if (arg.name === '@execute') {
                return arg;
            }
            return this.a_execute(arg);
        }
        return convertData(arg);
    }

    // Programs
    a_print(...args) {
        return new Program('@print', (context, args) => {
            args = toArgArray(context, args);
            let res = '';
            for (let i = 0; i < args.length; i++) {
                res += String(reduceArg(context, args[i]));
            }
            return res;
        }, args).evaluationStatic();
    }

    a_switch(...args) {
        return new Program('@switch', (context, args) => {
            args = toArgArray(context, args);

            if (args.length === 0) return "";

            let fallback = '';
            let limit = args.length;
            if (args.length % 2 === 1) {
                throw new Error("@switch has odd number of args");
            }

            if (args.length > 3) {
                fallback = args[args.length - 1];
                limit = args.length - 1;
            }

            const source = String(reduceArg(context, args[0]));
            
            for (let i = 1; i < limit; i += 2) {
                let key = String(reduceArg(context, args[i]));
                if (source === key) {
                    const res = convertData(context.bridge.a_execute(
                        convertData(args[i + 1])
                    ).execute(context));
                    return res;
                }
            }

            const res = convertData(context.bridge.a_execute(
                fallback
            ).execute(context));
            return res;
        }, args).evaluationStatic(({args, ignoredSubstitutions}) => {
            // No arguments
            if (args.length === 0) {
                return this.a_null();
            }

            const testContext = this.createTestContext();

            // Choice does not change
            if (isStaticArg(args[0], ignoredSubstitutions)) {
                const preview = reduceData(testContext, args[0]);
                for (let i = 1; i < args.length - 1; i += 2) {
                    if (!isStaticArg(args[i], ignoredSubstitutions)) continue;
                    const optionPreview = reduceData(testContext, args[i]);
                    if (preview === optionPreview) {
                        return this.wrapCompileJump(args[i+1]);
                    }
                }
            }

            // Only a fallback
            if (args.length === 2) {
                return this.wrapCompileJump(args[1]);
            }

            // Choices are the same
            const lastArg = args[args.length - 1];
            // We are making a special exception for strings, because if the
            // substitution code is the same, then it will create an
            // identical result, because they only change in parallel.
            if (
                isStaticArg(lastArg, ignoredSubstitutions) ||
                (typeof lastArg) === 'string'
            ) {
                const lastOutcome = reduceData(testContext, lastArg);
                for (let i = 2; i < args.length - 1; i += 2) {
                    const arg = args[i];
                    if (!(
                        isStaticArg(arg, ignoredSubstitutions) ||
                        (typeof arg) === 'string')
                    ) {
                        return undefined;
                    }
                    const outcome = reduceData(testContext, args[i]);
                    if (outcome != lastOutcome) return undefined;
                }

                return this.wrapCompileJump(lastArg);
            }
            
            return undefined;
        });
    }

    a_if(evalProgram, yesBranch, noBranch) {
        return this.a_switch(
            evalProgram,
            0, noBranch,
            yesBranch
        );
    }

    a_exists(evalProgram, yesBranch, noBranch) {
        return this.a_if(
            this.a_gt(evalProgram, -1),
            yesBranch,
            noBranch
        );
    }

    a_strcheck(...args) {
        return new Program('@strcheck', (context, args) => {
            args = toArgArray(context, args);
            for (let i = 0; i < args.length; i++) {
                let item = String(reduceArg(context, args[i]));
                if (item.length > 0) return item;
            }

            return "";
        }, args).evaluationStatic(({args, ignoredSubstitutions}) => {
            // No arguments
            if (args.length === 0) {
                return this.a_null();
            }

            const testContext = this.createTestContext();

            let contentIndex = -1;
            for (let i = 0; i < args.length; i++) {
                if (!isStaticArg(args[i], ignoredSubstitutions)) {
                    contentIndex = i;
                    break;
                }
                let item = String(reduceArg(testContext, args[i]));
                if (item.length > 0) {
                    contentIndex = i;
                    break;
                }
            }

            // Everything is always blank
            if (contentIndex === -1) return this.a_null();

            // First non-blank is static
            if (isStaticArg(args[contentIndex], ignoredSubstitutions)) {
                return this.wrapCompileJump(args[contentIndex]);
            }

            return undefined;
        });
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_strCheck(...args) {
        return this.a_strcheck(...args);
    }

    a_execute(...args) {
        return new Program('@execute', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@execute', args.length);
            }

            let line = filterExecutable(context, args[0]);

            while (line.isProgram || (line.isSequence && line.registeredInField)) {
                if (line.isSequence) {
                    line = filterExecutable(context,
                        (this.a_print(...line.programs)).execute(context)
                    );
                }
                else {
                    line = filterExecutable(context, line.execute(context));
                }
            }
            return line;
        }, args).evaluationStatic();
    }

    a_call(...args) {
        return new Program('@call', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@call', args.length);
            }

            const caller = context.bridge.dbrefGet(reduceArg(context, args[0]));
            const fieldName = reduceArg(context, args[1]);

            // There are more rules than this, but this rule is the primary
            // concern for the average MUDder.
            if (caller.owner != context.object.owner) {
                throw new Error("@call causes security error.");
            }

            const newContext = context.bridge.cloneContext(context);
            newContext.agent = caller;
            newContext.object = caller;

            return caller._executeField(newContext, fieldName);
        }, args).deepenContext();
    }

    a_fieldloop(...args) {
        return new Program('@fieldloop', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 3) {
                context.bridge.throwWrongArgCount('@fieldloop', args.length);
            }

            const fieldParent = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );
            const fieldPrefix = String(
                reduceArg(context, args[1])
            );
            const iterProgram = args[2];

            const namePair = {
                key: '%f',
                value: ''
            };
            const valuePair = {
                key: '%v',
                value: ''
            };
            context.bridge.registerSubstitution(context, namePair);
            context.bridge.registerSubstitution(context, valuePair);

            let res = '';

            for (let i = 0; i < fieldParent.fields.length; i++) {
                const myField = fieldParent.fields[i];
                if (!myField.fieldName.startsWith(fieldPrefix)) continue;
                namePair.value = myField.fieldName;
                valuePair.value = myField.value;
                res += context.bridge.processSubstitutions(
                    context, reduceData(context, iterProgram)
                );
            }

            context.bridge.retireSubstitution(namePair);
            context.bridge.retireSubstitution(valuePair);

            return res;
        }, args).deepenContext();
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_fieldLoop(...args) {
        return this.a_fieldloop(...args);
    }

    a_strloop(...args) {
        return new Program('@strloop', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 3) {
                context.bridge.throwWrongArgCount('@strloop', args.length);
            }

            const iterString = String(reduceArg(context, args[0]));

            if (iterString.length === 0) return "";

            const substKey = String(reduceArg(context, args[1]));
            const iterProgram = args[2];

            const charPair = {
                key: '%' + substKey,
                value: ''
            };
            context.bridge.registerSubstitution(context, charPair);

            let res = '';
            
            for (let i = 0; i < iterString.length; i++) {
                const myChar = iterString.charAt(i);
                charPair.value = myChar;
                res += context.bridge.processSubstitutions(
                    context, reduceData(context, iterProgram)
                );
            }

            context.bridge.retireSubstitution(charPair);

            return res;
        }, args).deepenContext().evaluationStatic(({args, ignoredSubstitutions}) => {
            if (isStaticArg(args[0], ignoredSubstitutions)) {
                const testContext = this.createTestContext();

                // Blank subject string makes loop obsolete
                if (String(reduceData(testContext, args[0])).length === 0) {
                    return this.a_null();
                }

                // The key is static...
                if (isStaticArg(args[1], ignoredSubstitutions)) {
                    const key = getSubstitutionKey(
                        String(reduceData(testContext, args[1]))
                    );

                    // So, with this static key, and a static string,
                    // see if this loop is solvable.
                    if (isStaticArg(args[2], [key, ...ignoredSubstitutions])) {
                        // Solve it, then:
                        return reduceData(testContext, this.a_strloop(...args));
                    }
                }
            }

            return undefined;
        });
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_strLoop(...args) {
        return this.a_strloop(...args);
    }

    a_contentsloop(...args) {
        throw new Error("@contentsloop not implemented!");
        //.deepenContext().evaluationStatic()
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_contentsLoop(...args) {
        return this.a_contentsloop(...args);
    }

    a_for(start, limit, iterProgram) {
        return this.a_countloop(limit, start, iterProgram);
    }

    a_countloop(...args) {
        return new Program('@countloop', (context, args) => {
            args = toArgArray(context, args);
            if (args.length < 3 || args.length > 4) {
                context.bridge.throwWrongArgCount('@countloop', args.length);
            }

            const limit = forceNumber(reduceArg(context, args[0]));
            const start = args.length === 3 ? 0 : forceNumber(reduceArg(
                context, args[1]
            ));

            if (start >= limit) return "";

            const substKey = String(reduceArg(
                context, args[args.length === 3 ? 1 : 2], false
            ));
            const iterProgram = args[args.length === 3 ? 2 : 3];

            const charPair = {
                key: '%' + substKey,
                value: ''
            };
            context.bridge.registerSubstitution(context, charPair);
            
            let res = '';

            for (let i = start; i < limit; i++) {
                charPair.value = String(i);
                res += context.bridge.processSubstitutions(
                    context, reduceData(context, iterProgram)
                );
            }

            context.bridge.retireSubstitution(charPair);

            return res;
        }, args).deepenContext().evaluationStatic(({args, ignoredSubstitutions}) => {
            const limitArg = args[0];
            const startArg = args.length === 3 ? 0 : args[1];

            if (!(isStaticArg(limitArg) && isStaticArg(startArg))) {
                return undefined;
            }

            // Loop works across a static range of numbers...

            const testContext = this.createTestContext();

            const limit = forceNumber(reduceArg(testContext, limitArg));
            const start = forceNumber(reduceArg(testContext, startArg));

            if (start >= limit) return this.a_null();

            const keyArg = args[args.length === 3 ? 1 : 2];
            const iterArg = args[args.length === 3 ? 2 : 3];

            // The key is static...
            if (isStaticArg(keyArg)) {
                const key = getSubstitutionKey(
                    String(reduceData(testContext, keyArg))
                );
                
                // So, with this static key, and a static string,
                // see if this loop is solvable.
                if (isStaticArg(iterArg, [key, ...ignoredSubstitutions])) {
                    // Solve it, then:
                    return reduceData(testContext, this.a_countloop(...args));
                }
            }

            return undefined;
        });
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_countLoop(...args) {
        return this.a_countloop(...args);
    }

    a_strlen(...args) {
        return new Program('@strlen', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@strlen', args.length);
            }

            return (String(reduceArg(context, args[0]))).length;
        }, args).evaluationStatic();
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_strLen(...args) {
        return this.a_strlen(...args);
    }

    a_substr(...args) {
        return new Program('@substr', (context, args) => {
            args = toArgArray(context, args);
            if (args.length < 2 || args.length > 3) {
                context.bridge.throwWrongArgCount('@substr', args.length);
            }

            const str = String(reduceArg(context, args[0]));
            let index = forceNumber(reduceArg(context, args[1]));
            let length = args.length === 2 ? undefined : forceNumber(reduceArg(
                context, args[2]
            ));

            if (index < 0) {
                index = str.length + index;
            }
            if (length === undefined) {
                length = str.length - index;
            }
            else if (length < 0) {
                length = (str.length - index) + length;
                if (length < 0) length = 0;
            }
            if (length === 0) return "";

            return str.substring(index, index + length);
        }, args).evaluationStatic();
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_subStr(...args) {
        return this.a_substr(...args);
    }

    a_lc(...args) {
        return new Program('@lc', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@lc', args.length);
            }

            const str = String(reduceArg(context, args[0]));

            if (str.length === 0) return str;

            return str.toLowerCase();
        }, args).evaluationStatic();
    }

    a_uc(...args) {
        return new Program('@uc', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@uc', args.length);
            }

            const str = String(reduceArg(context, args[0]));

            if (str.length === 0) return str;

            return str.toUpperCase();
        }, args).evaluationStatic();
    }

    a_lcfirst(...args) {
        return new Program('@lcfirst', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@lcfirst', args.length);
            }

            const str = String(reduceArg(context, args[0]));

            if (str.length === 0) return str;
            if (str.length === 1) return str.toLowerCase();

            return str.charAt(0).toLowerCase() +
                str.substring(1, str.length);
        }, args).evaluationStatic();
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_lcFirst(...args) {
        return this.a_lcfirst(...args);
    }

    a_ucfirst(...args) {
        return new Program('@ucfirst', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@ucfirst', args.length);
            }

            const str = String(reduceArg(context, args[0]));

            if (str.length === 0) return str;
            if (str.length === 1) return str.toUpperCase();

            return str.charAt(0).toUpperCase() +
                str.substring(1, str.length);
        }, args).evaluationStatic();
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_ucFirst(...args) {
        return this.a_ucfirst(...args);
    }

    a_substitute(...args) {
        return new Program('@substitute', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@substitute', args.length);
            }

            return context.bridge.processSubstitutions(
                context, reduceData(context, args[0])
            );
        }, args).evaluationStatic();
    }

    a_spformat(...args) {
        return new Program('@spformat', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@spformat', args.length);
            }

            const str = String(reduceArg(context, args[0]));

            if (str.length === 0) return str;

            return ' ' + str;
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_spFormat(...args) {
        return this.a_spformat(...args);
    }

    a_strcomp(...args) {
        return new Program('@strcomp', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@strcomp', args.length);
            }

            const strA = String(reduceArg(context, args[0]));
            const strB = String(reduceArg(context, args[1]));

            return strA.localeCompare(strB);
        }, args).evaluationStatic();
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_strComp(...args) {
        return this.a_strcomp(...args);
    }

    a_index(...args) {
        return new Program('@index', (context, args) => {
            args = toArgArray(context, args);
            if (args.length < 2 || args.length > 3) {
                context.bridge.throwWrongArgCount('@index', args.length);
            }

            const str = String(reduceArg(context, args[0]));
            const goal = String(reduceArg(context, args[1]));
            const start = args.length === 3 ? forceNumber(reduceArg(
                context, args[2]
            )) : 0;

            if (goal.length > str.length) return -1;
            if (goal.length === 0) return -1;
            if (str.length === 0) return -1;
            if (start >= str.length) return -1;
            if (start < 0) return -1;

            return str.indexOf(goal, start);
        }, args).evaluationStatic();
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_indexOf(...args) {
        return this.a_index(...args);
    }

    a_replace(...args) {
        return new Program('@replace', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 3) {
                context.bridge.throwWrongArgCount('@replace', args.length);
            }

            const str = String(reduceArg(context, args[0]));
            const goal = String(reduceArg(context, args[1]));
            const replacement = String(reduceArg(context, args[2]));

            if (str.length === 0) return str;
            if (goal.length === 0) return str;

            return reduceData(doFullReplacement(
                str, goal, replacement, false
            ));
        }, args).evaluationStatic();
    }

    a_transform(...args) {
        throw new Error("@transform not implemented!");
    }

    a_testflag(...args) {
        return new Program('@testflag', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@testflag', args.length);
            }

            const flagParent = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );
            const flagName = String(reduceArg(context, args[1]));

            return flagParent._getFlag(flagName) ? 1 : 0;
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_testFlag(...args) {
        return this.a_testflag(...args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getFlag(...args) {
        return this.a_testflag(...args);
    }

    a_setflag(...args) {
        return new Program('@setflag', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 3) {
                context.bridge.throwWrongArgCount('@setflag', args.length);
            }

            const flagParent = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );
            let flagName = String(reduceArg(context, args[1]));
            let state = true;
            if (flagName.startsWith('!')) {
                flagName = flagName.substring(1);
                state = false;
            }

            flagParent._setFlag(flagName, state);
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_setFlag(...args) {
        return this.a_setflag(...args);
    }

    a_getfield(...args) {
        return new Program('@getfield', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@getfield', args.length);
            }

            const fieldParent = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );
            const fieldName = String(reduceArg(context, args[1]));

            //console.log(fieldParent._getField(fieldName));

            return fieldParent._getField(fieldName);
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getField(...args) {
        return this.a_getfield(...args);
    }

    a_setfield(...args) {
        return new Program('@setfield', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 3) {
                context.bridge.throwWrongArgCount('@setfield', args.length);
            }

            const fieldParent = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );
            const fieldName = String(reduceArg(context, args[1]));

            fieldParent._setField(fieldName, convertData(args[2]));
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_setField(...args) {
        return this.a_setfield(...args);
    }

    a_g(...args) {
        return new Program('@g', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@g', args.length);
            }

            const varObj = reduceArg(
                context,
                context.object._getField('varobj')
            );

            const fieldParent = context.bridge.dbrefGet(varObj);
            const fieldName = String(reduceArg(context, args[0]));

            return fieldParent._getField(fieldName);
        }, args);
    }

    a_s(...args) {
        return new Program('@s', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@s', args.length);
            }

            const varObj = reduceArg(
                context,
                context.object._getField('varobj')
            );

            const fieldParent = context.bridge.dbrefGet(varObj);
            const fieldName = String(reduceArg(context, args[0]));

            fieldParent._setField(fieldName, convertData(args[1]));
        }, args);
    }

    a_location(...args) {
        return new Program('@location', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@location', args.length);
            }

            return context.bridge.dbrefGet(
                reduceArg(context, args[0])
            ).dbref;
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getLocation(...args) {
        return this.a_location(...args);
    }

    a_toploc(...args) {
        return new Program('@toploc', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@loploc', args.length);
            }

            let loc = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );

            while (loc && !loc.isRoom) {
                loc = loc.location;
            }

            return loc.dbref;
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_topLoc(...args) {
        return this.a_toploc(...args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getRoom(...args) {
        return this.a_toploc(...args);
    }

    a_move(...args) {
        return new Program('@move', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@move', args.length);
            }

            const a = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );
            const b = context.bridge.dbrefGet(
                reduceArg(context, args[1])
            );

            // These are not the full rules,
            // but these are the rules that matter to me.
            if (a.owner != context.object.owner) {
                throw new Error("@call causes security error.");
            }

            if (b.owner != context.object.owner) {
                throw new Error("@call causes security error.");
            }

            a.location = b;
        }, args);
    }

    a_setdest(...args) {
        return new Program('@setdest', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@setdest', args.length);
            }

            const a = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );
            const b = context.bridge.dbrefGet(
                reduceArg(context, args[1])
            );

            a._setField('link', b.dbref);
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_setDest(...args) {
        return this.a_setdest(...args);
    }

    a_player(...args) {
        return new Program('@player', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@player', args.length);
            }

            const name = String(
                reduceArg(context, args[0])
            );

            for (let i = 0; i < context.bridge.registeredObjects.length; i++) {
                const item = context.bridge.registeredObjects[i];
                if (!item.isPlayer) continue;
                if (item.matchesName(name)) return item.dbref;
            }

            throw new Error("No player by name: " + name);
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getPlayer(...args) {
        return this.a_player(...args);
    }

    a_object(...args) {
        return new Program('@object', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@object', args.length);
            }

            const name = String(
                reduceArg(context, args[1])
            );
            const loc = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );

            for (let i = 0; i < context.bridge.registeredObjects.length; i++) {
                const item = context.bridge.registeredObjects[i];
                if (!item.isObject) continue;
                if (item.location != loc) continue;
                if (item.matchesName(name)) return item.dbref;
            }

            console.log(
                "WARNING: No object in " + loc._getShortName() +
                " by name: " + name
            );

            return -1;
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getObject(...args) {
        return this.a_object(...args);
    }

    a_exit(...args) {
        return new Program('@exit', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@exit', args.length);
            }

            const name = String(
                reduceArg(context, args[1])
            );
            const loc = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );

            for (let i = 0; i < context.bridge.registeredObjects.length; i++) {
                const item = context.bridge.registeredObjects[i];
                if (!item.isExit) continue;
                if (item.location != loc) continue;
                if (item.matchesName(name)) return item.dbref;
            }

            console.log(
                "WARNING: No exit in " + loc._getShortName() +
                " by name: " + name
            );

            return -1;
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getExit(...args) {
        return this.a_exit(...args);
    }

    a_name(...args) {
        return new Program('@name', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@name', args.length);
            }

            // I think this is how it works?
            // Otherwise, how is this any different than shortname?
            return context.bridge.dbrefGet(
                reduceArg(context, args[0])
            ).vocab;
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getName(...args) {
        return this.a_name(...args);
    }

    a_shortname(...args) {
        return new Program('@shortname', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@shortname', args.length);
            }

            return context.bridge.dbrefGet(
                reduceArg(context, args[0])
            )._getShortName();
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getShortName(...args) {
        return this.a_shortname(...args);
    }

    a_type(...args) {
        return new Program('@type', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@type', args.length);
            }

            return context.bridge.dbrefGet(
                reduceArg(context, args[0])
            ).objectType;
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_getType(...args) {
        return this.a_type(...args);
    }

    a_eq(...args) {
        return new Program('@eq', (context, args) => {
            args = toArgArray(context, args);
            if (args.length < 2) {
                context.bridge.throwWrongArgCount('@eq', args.length);
            }

            const first = String(reduceArg(context, args[0]));

            for (let i = 1; i < args.length; i++) {
                const comp = String(reduceArg(context, args[i]));
                if (first != comp) return 0;
            }

            return 1;
        }, args).evaluationStatic(({args, ignoredSubstitutions}) => {
            const testContext = this.createTestContext();

            // Early static failure
            if (isStaticArg(args[0], ignoredSubstitutions)) {
                const preview = String(reduceData(testContext, args[0]));
                for (let i = 1; i < args.length; i++) {
                    if (!isStaticArg(args[i], ignoredSubstitutions)) {
                        return undefined;
                    }
                    const argPreview = String(reduceData(testContext, args[i]));
                    if (preview != argPreview) {
                        return 0;
                    }
                }
            }
            
            return undefined;
        });
    }

    a_lt(...args) {
        return new Program('@lt', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@lt', args.length);
            }

            const first = forceNumber(reduceArg(context, args[0]));
            const second = forceNumber(reduceArg(context, args[1]));

            return first < second ? 1 : 0;
        }, args).evaluationStatic();
    }

    a_gt(...args) {
        return new Program('@gt', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@gt', args.length);
            }

            const first = forceNumber(reduceArg(context, args[0]));
            const second = forceNumber(reduceArg(context, args[1]));

            return first > second ? 1 : 0;
        }, args).evaluationStatic();
    }

    a_and(...args) {
        return new Program('@and', (context, args) => {
            args = toArgArray(context, args);
            if (args.length === 0) {
                context.bridge.throwWrongArgCount('@and', args.length);
            }

            for (let i = 0; i < args.length; i++) {
                const comp = forceBool(reduceArg(context, args[i]));
                if (comp === 0) return 0;
            }

            return 1;
        }, args).evaluationStatic(({args, ignoredSubstitutions}) => {
            const testContext = this.createTestContext();

            // Early static failure
            if (isStaticArg(args[0], ignoredSubstitutions)) {
                const rawPreview = reduceArg(testContext, args[0]);
                if (!isBool(rawPreview)) return undefined;
                const preview = forceBool(rawPreview);
                if (preview === 0) return 0;
                for (let i = 1; i < args.length; i++) {
                    if (!isStaticArg(args[i], ignoredSubstitutions)) {
                        return undefined;
                    }
                    const rawArgPreview = reduceArg(testContext, args[i]);
                    if (!isBool(rawArgPreview)) return undefined;
                    const argPreview = forceBool(rawArgPreview);
                    if (argPreview === 0) {
                        return 0;
                    }
                }
            }
            
            return undefined;
        });
    }

    a_or(...args) {
        return new Program('@or', (context, args) => {
            args = toArgArray(context, args);
            if (args.length === 0) {
                context.bridge.throwWrongArgCount('@or', args.length);
            }

            for (let i = 0; i < args.length; i++) {
                const comp = forceBool(reduceArg(context, args[i]));
                if (comp === 1) return 1;
            }

            return 0;
        }, args).evaluationStatic(({args, ignoredSubstitutions}) => {
            const testContext = this.createTestContext();

            // Early static success
            if (isStaticArg(args[0], ignoredSubstitutions)) {
                const rawPreview = reduceArg(testContext, args[0]);
                if (!isBool(rawPreview)) return undefined;
                const preview = forceBool(rawPreview);
                if (preview === 1) return 1;
                for (let i = 1; i < args.length; i++) {
                    if (!isStaticArg(args[i], ignoredSubstitutions)) {
                        return undefined;
                    }
                    const rawArgPreview = reduceArg(testContext, args[i]);
                    if (!isBool(rawArgPreview)) return undefined;
                    const argPreview = forceBool(rawArgPreview);
                    if (argPreview === 1) {
                        return 1;
                    }
                }
            }
            
            return undefined;
        });
    }

    a_not(...args) {
        return new Program('@not', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@not', args.length);
            }

            return forceBool(reduceArg(context, args[0])) === 0 ? 1 : 0;
        }, args).evaluationStatic();
    }

    a_xor(...args) {
        return new Program('@xor', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@xor', args.length);
            }

            const first = forceBool(reduceArg(context, args[0]));
            const second = forceBool(reduceArg(context, args[1]));

            return first != second;
        }, args).evaluationStatic();
    }

    a_add(...args) {
        return new Program('@add', (context, args) => {
            args = toArgArray(context, args);
            if (args.length === 0) {
                context.bridge.throwWrongArgCount('@and', args.length);
            }

            let res = 0;

            for (let i = 0; i < args.length; i++) {
                res += forceNumber(reduceArg(context, args[i]));
            }

            return res;
        }, args).evaluationStatic();
    }

    a_sub(...args) {
        return new Program('@sub', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@sub', args.length);
            }

            const first = forceNumber(reduceArg(context, args[0]));
            const second = forceNumber(reduceArg(context, args[1]));

            return first - second;
        }, args).evaluationStatic();
    }

    a_mul(...args) {
        return new Program('@mul', (context, args) => {
            args = toArgArray(context, args);
            if (args.length === 0) {
                context.bridge.throwWrongArgCount('@mul', args.length);
            }

            let res = 1;

            for (let i = 0; i < args.length; i++) {
                res *= forceNumber(reduceArg(context, args[i]));
            }

            return res;
        }, args).evaluationStatic();
    }

    a_div(...args) {
        return new Program('@div', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@div', args.length);
            }

            const first = forceNumber(reduceArg(context, args[0]));
            const second = forceNumber(reduceArg(context, args[1]));

            return first / second;
        }, args).evaluationStatic();
    }

    a_idiv(...args) {
        return new Program('@idiv', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@idiv', args.length);
            }

            const first = forceNumber(reduceArg(context, args[0]));
            const second = forceNumber(reduceArg(context, args[1]));

            return Math.floor(first / second);
        }, args).evaluationStatic();
    }

    a_mod(...args) {
        return new Program('@mod', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@mod', args.length);
            }

            const first = forceNumber(reduceArg(context, args[0]));
            const second = forceNumber(reduceArg(context, args[1]));

            return first % second;
        }, args).evaluationStatic();
    }

    a_neg(...args) {
        return new Program('@neg', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@neg', args.length);
            }

            const first = forceNumber(reduceArg(context, args[0]));

            return first * -1;
        }, args).evaluationStatic();
    }

    a_log(...args) {
        throw new Error("@log not implemented!");
        //.evaluationStatic()
    }

    a_ln(...args) {
        throw new Error("@ln not implemented!");
        //.evaluationStatic()
    }

    a_exp(...args) {
        throw new Error("@exp not implemented!");
        //.evaluationStatic()
    }

    a_rand(...args) {
        return new Program('@rand', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 1) {
                context.bridge.throwWrongArgCount('@rand', args.length);
            }

            const max = forceNumber(reduceArg(context, args[0]));

            let res = Math.floor(Math.random() * max);
            if (res === max) res = max - 1;
            if (res < 0) res = 0;

            return res;
        }, args);
    }

    a_sin(...args) {
        throw new Error("@sin not implemented!");
        //.evaluationStatic()
    }

    a_cos(...args) {
        throw new Error("@cos not implemented!");
        //.evaluationStatic()
    }

    a_event(...args) {
        //TODO: Implement approximations of events
        throw new Error("@event not implemented!");
    }

    a_killevent(...args) {
        //TODO: Implement approximations of events
        throw new Error("@killevent not implemented!");
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_killEvent(...args) {
        return this.a_killevent(...args);
    }

    a_statevent(...args) {
        //TODO: Implement approximations of events
        throw new Error("@statevent not implemented!");
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_statEvent(...args) {
        return this.a_statevent(...args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_stateEvent(...args) {
        return this.a_statevent(...args);
    }

    a_tell(...args) {
        return new Program('@tell', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 2) {
                context.bridge.throwWrongArgCount('@tell', args.length);
            }

            const receiver = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );

            if (!receiver.isPlayer) {
                throw new Error(receiver._getShortName() + " is not a valid player.");
            }

            receiver.processMessage(String(reduceArg(context, args[1])));
        }, args);
    }

    a_tellroom(...args) {
        return new Program('@tellroom', (context, args) => {
            args = toArgArray(context, args);
            if (args.length != 3) {
                context.bridge.throwWrongArgCount('@tellroom', args.length);
            }

            const receiver = context.bridge.dbrefGet(
                reduceArg(context, args[0])
            );

            if (!receiver.isRoom) {
                throw new Error(receiver._getShortName() + " is not a valid room.");
            }

            const forbidden = [];
            const forbiddenCandidates = unpackSequence(context, args[1]);
            for (let i = 0; i < forbiddenCandidates.length; i++) {
                const item = context.bridge.dbrefGet(
                    reduceArg(context, forbiddenCandidates[i])
                );
                if (!item.isPlayer) continue;
                forbidden.push(item);
            }

            const msg = String(reduceArg(context, args[2]));

            for (let i = 0; i < context.bridge.registeredObjects.length; i++) {
                const item = context.bridge.registeredObjects[i];
                if (!item.isPlayer) continue;
                if (item.location != receiver) continue;
                if (forbidden.indexOf(item) > -1) continue;
                item.processMessage(msg);
            }
        }, args);
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_tellRoom(...args) {
        return this.a_tellroom(...args);
    }

    a_tellchannel(...args) {
        throw new Error("@tellchannel not implemented!");
    }

    /**
     * Misspell backup
     * @deprecated This is misspelled, but will still compile.
     * @private
     */
    a_tellChannel(...args) {
        return this.a_tellchannel(...args);
    }

    a_time(...args) {
        throw new Error("@time not implemented!");
    }

    a_let(...args) {
        return new Program('@let', (context, args) => {
            args = toArgArray(context, args);
            if (args.length < 3 || args.length % 2 === 0) {
                context.bridge.throwWrongArgCount('@let', args.length);
            }

            const subProgram = args[args.length - 1];

            const pairs = [];
            for (let i = 0; i < args.length - 1; i += 2) {
                const pair = {
                    key: '%' + String(reduceArg(context, args[i])),
                    value: args[i+1]
                };
                pairs.push(pair);
                context.bridge.registerSubstitution(context, pair);
            }

            const res = context.bridge.processSubstitutions(
                context, reduceData(context, subProgram)
            );

            for (let i = 0; i < pairs.length; i++) {
                context.bridge.retireSubstitution(pairs[i]);
            }

            return res;
        }, args).evaluationStatic(({args, ignoredSubstitutions}) => {
            const testContext = this.createTestContext();
            // Collect all the static keys, and see if that
            // allows the subProgram to be static.
            // a_let specifically is really hard to simplify,
            // due to substitution order rules, but we can
            // at least assist the subProgram in simplifying
            // instead.
            const staticKeys = [...ignoredSubstitutions];
            const headerArgs = [];
            for (let i = 0; i < args.length - 1; i += 2) {
                headerArgs.push(args[i]);
                headerArgs.push(args[i+1]);
                if (!isStaticArg(args[i])) continue;
                if (!isStaticArg(args[i+1])) continue;
                staticKeys.push(getSubstitutionKey(
                    String(reduceData(testContext, args[i]))
                ));
            }

            if (staticKeys.length === 0) return undefined;

            const subProgram = args[args.length - 1];

            if (isStaticArg(subProgram, staticKeys)) {
                // Solve it, then:
                return reduceData(testContext, this.a_let(
                    ...headerArgs,
                    subProgram
                ));
            }

            return undefined;
        });
    }

    a_null(...args) {
        return new Program('@null', (context, args) => {
            args = toArgArray(context, args);
            if (args.length > 0) {
                context.bridge.throwWrongArgCount('@null', args.length);
            }

            return "";
        }, args).evaluationStatic();
    }

    getCompilation(commandSeparator='%;', wrappedSemicolon=';') {
        const testContext = this.createTestContext();
        let res = '\n# COMPILATION RESULTS';
        for (let i = 0; i < this.registeredObjects.length; i++) {
            const obj = this.registeredObjects[i];
            if (obj.dbref <= 0) continue;
            res += '\n\n# ' + obj._getShortName() + ' (#' + obj.dbref + ')';
            if (obj.isPlayer) continue;
            res += this.wrapSemicolons(
                '\n@' + (obj.isRoom ? 'dig' : (obj.isExit ?
                        'open' : 'create'
                    )
                ) + ' ' + obj.vocab,
                wrappedSemicolon
            );
            if (!obj.isRoom && obj.location && obj.location.dbref != nowheredbref) {
                res += '\n@teleport #' + obj.dbref + ' = #' + obj.location.dbref
            }
            if (obj.flags.length + obj.fields.length > 0) {
                res += '\n';
            }

            for (let j = 0; j < obj.flags.length; j++) {
                const flag = obj.flags[j];
                res += '@set #' + String(obj.dbref) + '=' + flag;
            }

            if (obj.flags.length > 0) res += '\n';

            for (let j = 0; j < obj.fields.length; j++) {
                const field = obj.fields[j];
                if (j > 0) res += commandSeparator;
                res += this.wrapSemicolons(
                    field.compile(testContext), wrappedSemicolon
                );
            }
        }

        return res;
    }

    wrapSemicolons(str, wrappedSemicolon) {
        if (wrappedSemicolon === ';') return str;
        const semicolonRegEx = /;/g;
        return str.replace(semicolonRegEx, wrappedSemicolon);
    }

    finish(runResult=true, condense=true, commandSeparator='%;', wrappedSemicolon=';') {
        if (!condense) {
            commandSeparator='\n';
        }
        console.log(this.getCompilation(commandSeparator, wrappedSemicolon));

        if (runResult) {
            console.log('\n# EMULATOR RUNNING...\n');
            this.runEmulator();
        }
    }

    runEmulator() {
        const verblist = this.createStandardVerbList();

        console.log(
            'Use...' +
            '\n    $playername' +
            '\n...to take control of a player character.' +
            '\nPlayer characters available:'
        );
        for (let i = 0; i < this.registeredObjects.length; i++) {
            const player = this.registeredObjects[i];
            if (!player.isPlayer) continue;
            console.log('    ' + player._getShortName());
        }

        let playerInput = '';

        let currentAgent = null;

        let seenInvalidCommandMsg = false;

        do {
            const agentName = (currentAgent ?
                currentAgent._getShortName() : '(untethered)');
            console.log('');
            playerInput = prompt(agentName + '> ').trim().toLowerCase();
            console.log('');

            if (playerInput.startsWith('$')) {
                const nextAgentName = playerInput.substring(1);
                let agentFound = false;

                for (let i = 0; i < this.registeredObjects.length; i++) {
                    const player = this.registeredObjects[i];
                    if (!player.isPlayer) continue;
                    const playerName = player._getShortName();
                    if (playerName.toLowerCase() != nextAgentName) continue;
                    currentAgent = player;
                    console.log('Switching to ' + playerName + '...\n');
                    agentFound = true;

                    this.doLookAround(currentAgent);
                    break;
                }

                if (!agentFound) {
                    console.log(
                        'No player character found with name "' +
                        nextAgentName + '"'
                    );
                }
            }
            else if (playerInput.startsWith('@')) {
                console.log('Invalid command.');
                if (!seenInvalidCommandMsg) {
                    seenInvalidCommandMsg = true;
                    this.showInvalidCommandMessage();
                }
            }
            else if (playerInput === 'quit') {
                break;
            }
            else if (!currentAgent) {
                console.log('You need to control a player character first.');
            }
            else {
                let understood = false;
                //TODO: Match exit first, then verb

                // Exits

                for (let i = 0; i < verblist.length; i++) {
                    const verb = verblist[i];
                    if (verb.matches(playerInput) > -1) {
                        verb.handle(currentAgent, playerInput);
                        understood = true;
                        break;
                    }
                }

                if (!understood) {
                    console.log('Invalid command.');
                    if (!seenInvalidCommandMsg) {
                        seenInvalidCommandMsg = true;
                        this.showInvalidCommandMessage();
                    }
                }
                else {
                    //TODO: If puzzle inventory locks no longer match,
                    // drop the objects.
                }
            }
        } while(playerInput != 'quit');

        console.log('# EMULATOR HAS CLOSED.\n');
    }

    showInvalidCommandMessage() {
        console.log(
            'NOTE: This is not meant to be an exhaustive ' +
            'recreation of ifMUD. Not all commands have ' +
            'been implemented.'
        );
    }

    matchPhraseToObject(agent, phrase) {
        const lowerPhrase = phrase.toLowerCase();
        let agentTopLoc = agent.location;
        while (agentTopLoc && !agentTopLoc.isRoom) {
            agentTopLoc = agentTopLoc.location;
        }
        let bestMatch = undefined;
        let bestDegree = 10000;
        for (let i = 0; i < this.registeredObjects.length; i++) {
            const obj = this.registeredObjects[i];
            let objTopLoc = obj.location;
            while (objTopLoc && !objTopLoc.isRoom) {
                objTopLoc = objTopLoc.location;
            }
            if (agentTopLoc != objTopLoc) continue;
            const vocabs = obj.vocab.split(';');
            for (let j = 0; j < vocabs.length; j++) {
                const vocab = vocabs[j];
                if (vocab.indexOf(lowerPhrase) === -1) continue;
                const matchDegree = vocab.length - lowerPhrase.length;
                if (matchDegree < bestDegree) {
                    bestMatch = obj;
                    bestDegree = matchDegree;
                }
            }
        }
        return bestMatch;
    }

    createStandardVerbList() {
        const verblist = [];

        verblist.push(new Verb(this,
            [
                'examine', 'x', 'look at', 'read'
            ],
            (agent, tokens, front, middle, end) => {
                const obj = agent.bridge.matchPhraseToObject(agent, front);
                if (obj === undefined) {
                    console.log('You don\'t see that here.');
                    return;
                }

                const desc = obj._getField('description');
                if (desc && desc.length > 0) {
                    console.log(desc);
                }
                else {
                    console.log(
                        'You see nothing special about ' +
                        obj._getShortName() + '.'
                    );
                }

                //TODO: List obvious actions
            }
        ));

        verblist.push(new Verb(this,
            [
                'take', 'get', 'grab', 'hold'
            ],
            (agent, tokens, front, middle, end) => {
                const obj = agent.bridge.matchPhraseToObject(agent, front);
                if (obj === undefined) {
                    console.log('You don\'t see that here.');
                    return;
                }

                if (!obj.isObject) {
                    console.log('You cannot take that.');
                    return;
                }

                if (obj.location === agent) {
                    console.log('You already have that.');
                    return;
                }

                const context = agent.bridge.createContext(
                    agent, obj
                );

                if (!obj.passesLock(agent)) {
                    const hasResponse = obj.doFieldPair(context, 'fail');
                    if (!hasResponse) {
                        console.log('You cannot take that.');
                    }
                    return;
                }
                
                const hasResponse = obj.doFieldPair(context, 'success');
                if (!hasResponse) {
                    console.log('You take ' + obj._getShortName() + '.');
                }

                obj.location = agent;
            }
        ));

        verblist.push(new Verb(this,
            [
                'drop'
            ],
            (agent, tokens, front, middle, end) => {
                const obj = agent.bridge.matchPhraseToObject(agent, front);
                if (obj === undefined) {
                    console.log('You don\'t see that here.');
                    return;
                }

                if (obj.location != agent) {
                    console.log('You are not holdling that.');
                    return;
                }

                const context = agent.bridge.createContext(
                    agent, obj
                );
                
                const hasResponse = obj.doFieldPair(context, 'drop');
                if (!hasResponse) {
                    console.log('You drop ' + obj._getShortName() + '.');
                }

                obj.location = agent.location;
            }
        ));

        verblist.push(new Verb(this,
            [
                'inventory', 'inv', 'i'
            ],
            (agent, tokens, front, middle, end) => {
                let res = 'You are carrying ';

                let listedFirst = true;
                for (let i = 0; i < agent.bridge.registeredObjects.length; i++) {
                    const obj = agent.bridge.registeredObjects[i];
                    if (!obj.isObject) continue;
                    if (obj.location != agent) continue;
                    if (!listedFirst) res += ', ';
                    listedFirst = false;
                    res += obj._getShortName();
                }

                if (listedFirst) res += 'nothing';

                res += '.';

                console.log(res);
            }
        ));

        verblist.push(new Verb(this,
            [
                'look around', 'look', 'l'
            ],
            (agent, tokens, front, middle, end) => {
                agent.bridge.doLookAround(agent);
            }
        ));

        verblist.sort((a, b) => {
            return b.words[0].length - a.words[0].length;
        });

        return verblist;
    }

    doLookAround(agent) {
        console.log('//// ' + agent.location._getShortName());
        const desc = agent.location._getField('description');
        if (desc && desc.length > 0) {
            console.log(desc);
        }
        else {
            console.log(
                'You see nothing special about ' +
                agent.location._getShortName() + '.'
            );
        }

        const playerList = [];
        const objectList = [];
        const exitList = [];

        for (let i = 0; i < agent.bridge.registeredObjects.length; i++) {
            const obj = agent.bridge.registeredObjects[i];
            if (obj.location != agent.location) continue;
            if (obj.isPlayer && obj != agent) playerList.push(obj);
            else if (obj.isObject) objectList.push(obj);
            else if (obj.isExit) exitList.push(obj);
        }

        console.log('');

        if (playerList.length > 0) {
            console.log(
                'Players: ' +
                this.createList(agent, playerList)
            );
        }

        if (objectList.length > 0) {
            console.log(
                'You can see: ' +
                this.createList(agent, playerList)
            );
        }

        console.log(
            'Exits: ' +
            this.createList(agent, exitList, 'none')
        );
    }

    createList(agent, objArr, blankResponse='') {
        if (objArr.length === 0) return blankResponse;

        let res = '';

        let listedFirst = true;
        for (let i = 0; i < objArr.length; i++) {
            const obj = objArr[i];
            if (!listedFirst) res += ', ';
            listedFirst = false;
            res += obj._getShortName();
            if (obj.isExit) {
                const exitto = obj._executeField(
                    this.createContext(agent, obj),
                    'exitto'
                );
                if (String(exitto.length) > 0) {
                    res += ' (' + exitto + ')';
                }
            }
        }

        return res;
    }
}

class Verb {
    constructor(bridge, words, doer) {
        this.bridge = bridge;
        this.words = [];
        if (!Array.isArray(words)) {
            words = [words];
        }
        for (let i = 0; i < words.length; i++) {
            this.words.push(words[i].trim().toLowerCase());
        }
        this.words.sort((a, b) => b.length - a.length);
        this.doer = doer;
    }

    matches(phrase) {
        const lowered = phrase.trim().toLowerCase();
        for (let i = 0; i < this.words.length; i++) {
            const word = this.words[i];
            if (
                lowered.startsWith(word + ' ') || 
                lowered === word
            ) {
                return i;
            }
        }
        return -1;
    }

    handle(agent, phrase) {
        const match = this.words[this.matches(phrase)];
        const tokens = (phrase.length === match.length ?
            '' : phrase.substring(match.length).trim());
        let front = tokens;
        let middle = '';
        let end = '';
        if (tokens.length > 0) {
            if (tokens.indexOf('=') > -1) {
                const firstSplit = tokens.split('=');
                front = firstSplit[0].trim();
                const secondFragment = firstSplit[1].trim();
                if (secondFragment.indexOf(':')) {
                    const secondSplit = secondFragment.split(':');
                    middle = secondSplit[0].trim();
                    end = secondSplit[1].trim();
                }
                else {
                    middle = secondFragment;
                }
            }
        }
        this.doer(agent, tokens, front, middle, end);
    }
}

module.exports = {
    createBridge() {
        return new JotaBridge();
    }
};