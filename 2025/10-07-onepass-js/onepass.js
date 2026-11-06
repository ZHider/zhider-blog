var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
function signData(data, key = "") {
    return __awaiter(this, void 0, void 0, function* () {
        const encoder = new TextEncoder();
        let dataBytes = encoder.encode(data);
        let keyBytes = encoder.encode(key);
        const cryptoKey = yield window.crypto.subtle.importKey("raw", keyBytes, {
            name: "HMAC",
            hash: { name: "SHA-256" }
        }, false, ["sign"]);
        const signature = yield window.crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
        const signatureArray = new Uint8Array(signature);
        let base64String = btoa(String.fromCharCode.apply(null, signatureArray));
        return base64String + "\n";
    });
}
function transformCharacters(charArray) {
    const charMap = {
        "A": "!",
        "E": "@",
        "I": "#",
        "M": "$",
        "Q": "%",
        "U": "^",
        "Y": "&"
    };
    for (let i = 1; i < charArray.length; i++) {
        const currentChar = charArray[i];
        if (isNaN(parseInt(currentChar))) {
            if (currentChar === "z") {
                charArray[i] = "*";
            }
            else if (charMap[currentChar.toUpperCase()]) {
                charArray[i] = charMap[currentChar.toUpperCase()];
            }
        }
    }
}
function replaceSpecialCharacters(charArray) {
    for (let i = 0; i <= 31; i++) {
        if (charArray[i] === "+" || charArray[i] === "/") {
            charArray[i] = "6";
        }
    }
}
function encrypt(data, key, enableTransform, enableReplace, lengthLimit) {
    return __awaiter(this, void 0, void 0, function* () {
        if (data && key) {
            let result = yield signData(data, key);
            result = yield signData(result, "BmL6cwcs0MzmEMXj");
            let charArray = Array.from(result);
            if (enableTransform) {
                transformCharacters(charArray);
            }
            if (enableReplace) {
                replaceSpecialCharacters(charArray);
                if (isNaN(parseInt(charArray[0]))) {
                    charArray[0] = charArray[0].toUpperCase();
                }
                else {
                    charArray[0] = "M";
                }
            }
            return charArray.slice(0, lengthLimit).join("");
        }
        else {
            return "";
        }
    });
}
window.encrypt = encrypt;
