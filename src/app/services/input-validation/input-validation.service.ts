import { Injectable } from '@angular/core';
import { OperationService } from '../operation/operation.service';
import * as zxcvbn from 'zxcvbn';
import { CONSTANTS } from '../../../environments/environment';
import { TranslateService } from '@ngx-translate/core';
import { valueDecoder } from '@taquito/local-forging/dist/lib/michelson/codec';
import { Uint8ArrayConsumer } from '@taquito/local-forging/dist/lib/uint8array-consumer';
import { utils } from '@tezos-core-tools/crypto-utils';
import * as bip39 from 'bip39';
@Injectable()
export class InputValidationService {
  constructor(private operationService: OperationService, private translate: TranslateService) {}
  /*
    Input validations
  */
  mnemonics(mnemonics: string): boolean {
    return this.operationService.validMnemonic(mnemonics);
  }
  password(password: string): boolean {
    return zxcvbn(password).score === 4;
  }
  passwordStrengthDisplay(password: string): string {
    if (!password) {
      return '';
    }
    switch (zxcvbn(password).score) {
      case 0: {
        return this.translate.instant('INPUTVALIDATIONCOMPONENT.CATASTROPHIC'); // 'Catastrophic!'
      }
      case 1: {
        return this.translate.instant('INPUTVALIDATIONCOMPONENT.VERYWEAK'); // 'Very weak!'
      }
      case 2: {
        return this.translate.instant('INPUTVALIDATIONCOMPONENT.WEAK'); // 'Weak!'
      }
      case 3: {
        return this.translate.instant('INPUTVALIDATIONCOMPONENT.WEAK'); // 'Weak!'
      }
      case 4: {
        return this.translate.instant('INPUTVALIDATIONCOMPONENT.STRONG'); // 'Strong!'
      }
      default: {
        return '';
      }
    }
  }
  address(address: string): Boolean {
    return this.operationService.validAddress(address);
  }
  torusAccount(verifierId: string, loginType: string): Boolean {
    switch (loginType) {
      case 'google':
        return this.email(verifierId);
      case 'email':
        return this.email(verifierId);
      case 'reddit':
        return this.redditAccount(verifierId);
      case 'twitter':
        return this.twitterAccount(verifierId);
      case 'domain':
        return this.tezosDomain(verifierId);
      default:
        return false;
    }
  }
  redditAccount(username: string) {
    // Letters, numbers, dashes, and underscores only
    // Username must be between 3 and 20 characters
    const re = /^[0-9a-zA-Z\-\_]{3,20}$/;
    return re.test(username);
  }
  email(email: string): Boolean {
    const re =
      /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
  }
  tezosDomain(domain: string) {
    const a = domain.split('.');
    // basic validation that is in the correct format
    for (const sub of a) {
      if (!sub.length) {
        return false;
      }
    }
    return a.length >= 2 && CONSTANTS.TEZOS_DOMAIN.TOP_DOMAINS.includes(a[a.length - 1]);
  }
  twitterAccount(username: string) {
    // The only characters you can use are uppercase and lowercase letters, numbers, and the underscore character ( _ ).
    const re = /^\@{1}[0-9a-zA-Z\_]{1,15}$/;
    return re.test(username);
  }
  twitterId(id: string) {
    const re = /^[0-9]+$/;
    return re.test(id);
  }
  passphrase(passphrase: string): Boolean {
    return true;
  }
  amount(amount: string, decimals: number = 6): Boolean {
    const decimalsPart = decimals ? `(\.[0-9]{1,${decimals}}){0,1}` : '';
    const expr = new RegExp(`^(0|[1-9][0-9]*)${decimalsPart}$`, 'g');
    if (amount === '' || amount === '0') {
      // default value / zero
      return true;
    } else if (Number(amount) && amount.match(expr)) {
      // Positive number
      return true;
    }
    return false;
  }
  fee(fee: string): Boolean {
    return this.amount(fee); // same as amount
  }
  gas(amount: string): Boolean {
    if (amount === '' || amount === '0') {
      // default value / zero
      return true;
    } else if (Number(amount) && 0 < Number(amount) && Number(amount) % 1 === 0) {
      // Positive integer
      return true;
    } else {
      return false;
    }
  }
  storage(amount: string) {
    return this.gas(amount);
  }
  relativeLimit(limit: string) {
    if (limit?.length > 2 && limit.startsWith('+') && limit.endsWith('%')) {
      return this.gas(limit.slice(1, -1));
    }
    return false;
  }
  code(code: string): Boolean {
    if (code && code.length === 40 && code.match(/^[0-9a-f]*$/g)) {
      // 40 hex chars
      return true;
    } else {
      return false;
    }
  }
  derivationPath(path: string): Boolean {
    const m = path.match(/^44\'\/1729(\'\/[0-9]+)+\'$/g);
    if (m || path === "44'/1729'") {
      return true;
    }
    return false;
  }
  hexString(hex: string): Boolean {
    if (hex && hex.match(/^[a-f0-9]*$/)) {
      return true;
    } else {
      return false;
    }
  }
  isMessageSigning(payload: string): boolean {
    if (payload.match(/^0501[a-f0-9]{8}54657a6f73205369676e6564204d6573736167653a20[a-f0-9]*$/)) {
      return true;
    }
    return false;
  }
  isMichelineExpr(hex: string) {
    try {
      if (!this.hexString(hex)) {
        throw new Error('Not a hex string');
      }
      if (hex.slice(0, 2) !== '05') {
        throw new Error('invalid prefix');
      }
      const parsedPayload = valueDecoder(Uint8ArrayConsumer.fromHexString(hex.slice(2)));
      console.log('Parsed sign payload', parsedPayload);
    } catch (e) {
      console.warn(e.message ? 'Decoding: ' + e.message : e);
      return false;
    }
    return true;
  }
  invalidMnemonic(words: string): string {
    if (utils.validMnemonic(words)) {
      return '';
    }
    // number of words
    const wordCount = words?.split(' ').filter((w) => w?.length > 0).length;
    if (![12, 15, 18, 21, 24].includes(wordCount)) {
      let extra = '';
      if (wordCount >= 11 && wordCount <= 25) {
        const rest = (wordCount % 3) - 1;
        extra = rest ? ', missing one word?' : ', one word too many?';
      }
      return `Invalid number of words: ${wordCount}${extra}`;
    }
    // words in wordlist
    if (words?.split(' ')) {
      for (let word of words?.split(' ').filter((w) => w?.length > 0)) {
        const r = bip39.wordlists.english.filter((w) => w === word);
        if (r.length === 0 && word) {
          return `Invalid seed word: ${word}`;
        }
      }
    }
    // checksum
    return 'Invalid checksum! Double-check the order of the seed words.';
  }
}
