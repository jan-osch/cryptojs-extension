/* 
 * The MIT License (MIT)
 * 
 * Copyright (c) 2015 artjomb
 */
(function(C){
    // put on ext property in CryptoJS
    var ext;
    if (!C.hasOwnProperty("ext")) {
        ext = C.ext = {};
    } else {
        ext = C.ext;
    }
    
    // Shortcuts
    var Base = C.lib.Base;
    var WordArray = C.lib.WordArray;
    var AES = C.algo.AES;
    
    // Constants
    ext.const_Zero = WordArray.create([0x00000000, 0x00000000, 0x00000000, 0x00000000]);
    ext.const_One = WordArray.create([0x00000000, 0x00000000, 0x00000000, 0x00000001]);
    ext.const_Rb = WordArray.create([0x00000000, 0x00000000, 0x00000000, 0x00000087]);
    ext.const_nonMSB = WordArray.create([0xFFFFFFFF, 0xFFFFFFFF, 0x7FFFFFFF, 0x7FFFFFFF]); // 1^64 || 0^1 || 1^31 || 0^1 || 1^31
    
    /**
     * Looks into the object to see if it is a WordArray.
     * 
     * @param obj Some object
     * 
     * @returns {boolean}
     
     */
    ext.isWordArray = function(obj) {
        return obj && typeof obj.clamp === "function" && typeof obj.concat === "function" && typeof obj.words === "array";
    }
    
    /**
     * This padding is a 1 bit followed by as many 0 bits as needed to fill 
     * up the block. This implementation doesn't work on bits directly, 
     * but on bytes. Therefore the granularity is much bigger.
     */
    C.pad.OneZeroPadding = {
        pad: function (data, blocksize) {
            // Shortcut
            var blockSizeBytes = blocksize * 4;

            // Count padding bytes
            var nPaddingBytes = blockSizeBytes - data.sigBytes % blockSizeBytes;
            
            // Create padding
            var paddingWords = [];
            for (var i = 0; i < nPaddingBytes; i += 4) {
                var paddingWord = 0x00000000;
                if (i === 0) {
                    paddingWord = 0x80000000;
                }
                paddingWords.push(paddingWord);
            }
            var padding = WordArray.create(paddingWords, nPaddingBytes);

            // Add padding
            data.concat(padding);
        },
        unpad: function () {
            // TODO: implement
        }
    };
    
    /**
     * No padding is applied. This is necessary for streaming cipher modes 
     * like CTR.
     */
    C.pad.NoPadding = {
        pad: function () {},
        unpad: function () {}
    };
    
    /**
     * Shifts the array by n bits to the left. Zero bits are added as the 
     * least significant bits. This operation modifies the current array.
     * 
     * @param {WordArray} wordArray WordArray to work on
     * @param {int} n Bits to shift by
     * 
     * @returns the WordArray that was passed in
     */
    ext.bitshift = function(wordArray, n){
        if (n > 0) {
            var carry = 0;
            var wres;
            for(var i = wordArray.words.length - 1; i >= 0; i--) {
                wres = wordArray.words[i];
                wordArray.words[i] <<= n;
                wordArray.words[i] |= carry;
                carry = wres >>> (32 - n);
            }
            return carry;
        } else if (n < 0) {
            // TODO: implement
        }
        
        // Chainable
        return wordArray;
    };
    
    /**
     * Returns the n leftmost words of the WordArray.
     * 
     * @param {WordArray} wordArray WordArray to work on
     * @param {int} n Words to retrieve
     * 
     * @returns new WordArray
     */
    ext.leftmostWords = function(wordArray, n){
        var lmArray = wordArray.clone();
        lmArray.sigBytes = n * 4;
        lmArray.clamp();
        return lmArray;
    };
    
    /**
     * Returns the n leftmost bytes of the WordArray.
     * 
     * @param {WordArray} wordArray WordArray to work on
     * @param {int} n Bytes to retrieve
     * 
     * @returns new WordArray
     */
    ext.leftmostBytes = function(wordArray, n){
        var lmArray = wordArray.clone();
        lmArray.sigBytes = n;
        lmArray.clamp();
        return lmArray;
    };
    
    /**
     * Returns the n rightmost bytes of the WordArray.
     * 
     * @param {WordArray} wordArray WordArray to work on
     * @param {int} n Bytes to retrieve (must be positive)
     * 
     * @returns new WordArray
     */
    ext.rightmostBytes = function(wordArray, n){
        wordArray.clamp();
        var wordSize = 32;
        var rmArray = wordArray.clone();
        var bitsToShift = (rmArray.sigBytes - n) * 8;
        if (bitsToShift >= wordSize) {
            var popCount = Math.floor(bitsToShift/wordSize);
            bitsToShift -= popCount * wordSize;
            rmArray.words.splice(0, popCount);
            rmArray.sigBytes -= popCount * wordSize / 8;
        }
        if (bitsToShift > 0) {
            ext.bitshift(rmArray, bitsToShift);
            rmArray.sigBytes -= bitsToShift / 8;
        }
        return rmArray;
    };
    
    /**
     * Returns the n rightmost words of the WordArray. It assumes 
     * that the current WordArray has at least n words.
     * 
     * @param {WordArray} wordArray WordArray to work on
     * @param {int} n Words to retrieve (must be positive)
     * 
     * @returns popped words as new WordArray
     */
    ext.popWords = function(wordArray, n){
        var left = ext.leftmostWords(wordArray, n);
        wordArray.words = wordArray.words.slice(n);
        wordArray.sigBytes -= n * 4;
        return left;
    };
    
    /**
     * Shifts the array to the left and returns the shifted dropped elements 
     * as WordArray. The initial WordArray must contain at least n bytes and 
     * they have to be significant.
     * 
     * @param {WordArray} wordArray WordArray to work on (is modified)
     * @param {int} n Bytes to shift (must be positive, default 16)
     * 
     * @returns new WordArray
     */
    ext.shiftBytes = function(wordArray, n){
        n = n || 16;
        var r = n % 4;
        n -= r;
        
        var shiftedArray = WordArray.create();
        for(var i = 0; i < n; i += 4) {
            shiftedArray.words.push(wordArray.words.shift());
            wordArray.sigBytes -= 4;
            shiftedArray.sigBytes += 4;
        }
        if (r > 0) {
            shiftedArray.words.push(wordArray.words[0]);
            shiftedArray.sigBytes += r;
            
            ext.bitshift(wordArray, r * 8);
            wordArray.sigBytes -= r;
        }
        return shiftedArray;
    };
    
    /**
     * Applies XOR on both given word arrays and returns a third resulting 
     * WordArray. The initial word arrays must have the same length 
     * (significant bytes).
     * 
     * @param {WordArray} wordArray1 WordArray
     * @param {WordArray} wordArray2 WordArray
     * 
     * @returns first passed WordArray (modified)
     */
    ext.xor = function(wordArray1, wordArray2){
        for(var i = 0; i < wordArray1.words.length; i++) {
            wordArray1.words[i] ^= wordArray2.words[i];
        }
        return wordArray1;
    };
    
    /**
     * XORs arr2 to the end of arr1 array. This doesn't modify the current 
     * array aside from clamping.
     * 
     * @param {WordArray} arr1 Bigger array
     * @param {WordArray} arr2 Smaller array to be XORed to the end
     * 
     * @returns new WordArray
     */
    ext.xorendBytes = function(arr1, arr2){
        // TODO: more efficient
        return ext.leftmostBytes(arr1, arr1.sigBytes-arr2.sigBytes)
                .concat(ext.xor(ext.rightmostBytes(arr1, arr2.sigBytes), arr2));
    };
    
    /**
     * Logical AND between the two passed arrays. Both arrays must have the 
     * same length.
     * 
     * @param {WordArray} arr1 Array 1
     * @param {WordArray} arr2 Array 2
     * 
     * @returns new WordArray
     */
    ext.bitand = function(arr1, arr2){
        var newArr = arr1.clone(),
            tw = newArr.words,
            ow = arr2.words;
        for(var i = 0; i < tw.length; i++) {
            tw[i] &= ow[i];
        }
        return newArr;
    };
    
    /**
     * Doubling operation on a 128-bit value. This operation modifies the 
     * passed array.
     * 
     * @param {WordArray} wordArray WordArray to work on
     * 
     * @returns passed WordArray
     */
    ext.dbl = function(wordArray){
        var carry = ext.msb(wordArray);
        ext.bitshift(wordArray, 1);
        if (carry === 1) {
            ext.xor(wordArray, ext.const_Rb);
        }
        return wordArray;
    };
    
    /**
     * Check whether the word arrays are equal.
     * 
     * @param {WordArray} arr1 Array 1
     * @param {WordArray} arr2 Array 2
     *
     * @returns boolean
     */
    ext.equals = function(arr1, arr2){
        if (!arr2 || !arr2.words || arr1.sigBytes !== arr2.sigBytes) {
            return false;
        }
        arr1.clamp();
        arr2.clamp();
        for(var i = 0; i < arr1.words.length; i++) {
            if (arr1.words[i] !== arr2.words[i]) {
                return false;
            }
        }
        return true;
    };
    
    /**
     * Retrieves the most significant bit of the WordArray as an Integer.
     *
     * @param {WordArray} arr
     *
     * @returns Integer
     */
    ext.msb = function(arr) {
        return arr.words[0] >>> 31;
    }
})(CryptoJS);// see http://csrc.nist.gov/publications/nistpubs/800-38a/sp800-38a.pdf

/**
 * Cipher Feedback block mode.
 */
CryptoJS.mode.CFBx = (function () {
    var CFBx = CryptoJS.lib.BlockCipherMode.extend();

    CFBx.Encryptor = CFBx.extend({
        processBlock: function (words, offset) {
            // Shortcuts
            var cipher = this._cipher;
            var blockSize = cipher.blockSize; // in words
            var iv = this._iv;
            var prev = this._prevBlock;
            var segmentSize = cipher.cfg.segmentSize / 32; // in words
            
            // somehow the wrong indexes are used
            for(var i = 0; i < blockSize/segmentSize; i++) {
                if (iv) {
                    prev = iv.slice(0); // clone

                    // Remove IV for subsequent blocks
                    iv = this._iv = undefined;
                } else {
                    prev = prev.slice(segmentSize).concat(this._ct);
                }
                var segKey = prev.slice(0); // clone
                cipher.encryptBlock(segKey, 0);

                // Encrypt segment
                for (var j = 0; j < segmentSize; j++) {
                    words[offset + i * segmentSize + j] ^= segKey[j];
                }
                this._ct = words.slice(offset + i * segmentSize, offset + i * segmentSize + segmentSize);
            }
            this._prevBlock = prev;
        }
    });

    CFBx.Decryptor = CFBx.extend({
        processBlock: function (words, offset) {
            // Shortcuts
            var cipher = this._cipher;
            var blockSize = cipher.blockSize; // in words
            var iv = this._iv;
            var prev = this._prevBlock;
            var segmentSize = cipher.cfg.segmentSize / 32; // in words
            
            // somehow the wrong indexes are used
            for(var i = 0; i < blockSize/segmentSize; i++) {
                if (iv) {
                    prev = iv.slice(0); // clone

                    // Remove IV for subsequent blocks
                    iv = this._iv = undefined;
                } else {
                    prev = prev.slice(segmentSize).concat(this._ct);
                }
                this._ct = words.slice(offset + i * segmentSize, offset + i * segmentSize + segmentSize);
                var segKey = prev.slice(0); // clone
                cipher.encryptBlock(segKey, 0);

                // Encrypt segment
                for (var j = 0; j < segmentSize; j++) {
                    words[offset + i * segmentSize + j] ^= segKey[j];
                }
            }
            this._prevBlock = prev;
        }
    });

    function generateKeystreamAndEncrypt(words, offset, blockSize, i, cipher) {
        // Shortcut
        var iv = this._iv;

        // Generate keystream
        if (iv) {
            var keystream = iv.slice(0);

            // Remove IV for subsequent blocks
            this._iv = undefined;
        } else {
            var keystream = this._prevBlock;
        }
        cipher.encryptBlock(keystream, 0);

        // Encrypt
        for (var i = 0; i < blockSize; i++) {
            words[offset + i] ^= keystream[i];
        }
    }

    return CFBx;
}());