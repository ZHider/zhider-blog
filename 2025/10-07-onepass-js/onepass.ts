/**
 * 加密模块 - 提供数据加密功能
 * 这个模块实现了基于HMAC-SHA256的加密算法，并包含多层处理和混淆
 */


// 定义加密配置参数类型

/**
 * 内部HMAC签名函数
 * @param data 要签名的数据
 * @param key 签名密钥
 * @returns 签名结果的Base64字符串
 */
async function signData(data: string, key: string = ""): Promise<string> {

  // 创建文本编码器
  const encoder = new TextEncoder();
  
  // 将数据和密钥编码为字节数组
  let dataBytes = encoder.encode(data);
  let keyBytes = encoder.encode(key);
  
  // 导入密钥用于HMAC签名
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    keyBytes,
    {
      name: "HMAC",
      hash: { name: "SHA-256" }
    },
    false,
    ["sign"]
  );
  
  // 执行HMAC签名
  const signature = await window.crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
  
  // 将签名结果转换为Base64字符串
  const signatureArray = new Uint8Array(signature);
  let base64String = btoa(String.fromCharCode.apply(null, signatureArray));
  
  return base64String + "\n";
}

/**
 * 字符转换函数 - 将特定字符映射为特殊符号
 * @param charArray 字符数组
 */
function transformCharacters(charArray: string[]): void {
  // 定义字符映射表
  const charMap: Record<string, string> = {
    "A": "!",
    "E": "@",
    "I": "#",
    "M": "$",
    "Q": "%",
    "U": "^",
    "Y": "&"
  };
  
  // 遍历字符数组进行转换
  for (let i = 1; i < charArray.length; i++) {
    const currentChar = charArray[i];
    
    // 检查是否为非数字字符
    if (isNaN(parseInt(currentChar))) {
      // 如果是'z'则替换为'*'
      if (currentChar === "z") {
        charArray[i] = "*";
      } 
      // 如果在映射表中则进行映射替换
      else if (charMap[currentChar.toUpperCase()]) {
        charArray[i] = charMap[currentChar.toUpperCase()]!;
      }
    }
  }
}

/**
 * 特殊字符替换函数 - 将'+'和'/'替换为'6'
 * @param charArray 字符数组
 */
function replaceSpecialCharacters(charArray: string[]): void {
  // 替换前32个字符中的'+'和'/'为'6'
  for (let i = 0; i <= 31; i++) {
    if (charArray[i] === "+" || charArray[i] === "/") {
      charArray[i] = "6";
    }
  }
}

/**
 * 主加密函数
 * @param data 要加密的数据
 * @param key 加密密钥
 * @param enableTransform 是否启用字符转换
 * @param enableReplace 是否启用特殊字符替换
 * @param lengthLimit 返回结果的长度限制
 * @returns 加密后的字符串
 */
async function encrypt(
  data: string,
  key: string,
  enableTransform: boolean,
  enableReplace: boolean,
  lengthLimit: number
): Promise<string> {
  // 如果数据和密钥都存在
  if (data && key) {
    // 第一层HMAC签名
    let result = await signData(data, key);
    
    // 第二层HMAC签名，使用固定密钥"BmL6cwcs0MzmEMXj"
    result = await signData(result, "BmL6cwcs0MzmEMXj");
    
    // 将结果转换为字符数组
    let charArray = Array.from(result);
    
    // 如果启用字符转换
    if (enableTransform) {
      transformCharacters(charArray);
    }
    
    // 如果启用特殊字符替换
    if (enableReplace) {
      replaceSpecialCharacters(charArray);
      
      // 如果第一个字符不是数字，则转换为大写
      if (isNaN(parseInt(charArray[0]))) {
        charArray[0] = charArray[0].toUpperCase();
      } 
      // 如果第一个字符是数字，则替换为"M"
      else {
        charArray[0] = "M";
      }
    }
    
    // 截取指定长度并连接成字符串返回
    return charArray.slice(0, lengthLimit).join("");
  } 
  // 如果数据或密钥为空，返回空字符串
  else {
    return "";
  }
}

// 将加密函数挂载到window对象上
window.encrypt = encrypt;
