import { Component, OnInit, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { KeyPair, DefaultTransactionParams, ExternalRequest } from '../../../interfaces';
import { WalletService } from '../../../services/wallet/wallet.service';
import { CoordinatorService } from '../../../services/coordinator/coordinator.service';
import { OperationService } from '../../../services/operation/operation.service';
import { InputValidationService } from '../../../services/input-validation/input-validation.service';
import { LedgerService } from '../../../services/ledger/ledger.service';
import { LedgerWallet, Account, TorusWallet } from '../../../services/wallet/wallet';
import { MessageService } from '../../../services/message/message.service';
import Big from 'big.js';
import { emitMicheline, assertMichelsonData, assertMichelsonContract } from '@taquito/michel-codec';
import { EstimateService } from '../../../services/estimate/estimate.service';
import { Subscription } from 'rxjs';
import { ModalComponent } from '../modal.component';
import { SubjectService } from '../../../services/subject/subject.service';

const zeroTxParams: DefaultTransactionParams = {
  gas: 0,
  storage: 0,
  fee: 0,
  burn: 0
};

@Component({
  selector: 'app-originate',
  templateUrl: './originate.component.html',
  styleUrls: ['../../../../scss/components/modals/modal.scss']
})
export class OriginateComponent extends ModalComponent implements OnInit, OnChanges, OnDestroy {
  readonly beaconMode = true;
  @Input() externalRequest: ExternalRequest;
  @Output() operationResponse = new EventEmitter();
  syncSub: Subscription;
  defaultTransactionParams: DefaultTransactionParams = zeroTxParams;
  costPerByte: string = this.estimateService.costPerByte;

  balance = '';
  script: any;

  customFee = '';
  customGas = '';
  customStorage = '';

  pwdInvalid: string;
  formInvalid = '';
  sendResponse: any;
  ledgerError = '';
  simError = '';

  password: string;
  advancedForm = false;
  simSemaphore = 0;
  activeTab = 0;

  name = 'originate';

  private subscriptions: Subscription = new Subscription();

  constructor(
    private walletService: WalletService,
    private operationService: OperationService,
    private coordinatorService: CoordinatorService,
    private inputValidationService: InputValidationService,
    private ledgerService: LedgerService,
    private messageService: MessageService,
    private estimateService: EstimateService,
    private subjectService: SubjectService
  ) {
    super();
  }
  ngOnInit(): void {}
  ngOnChanges(changes: SimpleChanges): void {
    if (this.beaconMode) {
      if (
        this.externalRequest?.operationRequest?.operationDetails?.length === 1 &&
        this.externalRequest.operationRequest.operationDetails[0].kind === 'origination'
      ) {
        if (this.isValidOrigination()) {
          this.openModal();
          this.balance = Big(this.externalRequest.operationRequest.operationDetails[0].balance)
            .div(10 ** 6)
            .toFixed();
          this.script = this.externalRequest.operationRequest.operationDetails[0].script;
          const recommendations = {
            gasRecommendation: this.externalRequest.operationRequest.operationDetails[0].gas_limit
              ? this.externalRequest.operationRequest.operationDetails[0].gas_limit
              : undefined,
            storageRecommendation: this.externalRequest.operationRequest.operationDetails[0].storage_limit
              ? this.externalRequest.operationRequest.operationDetails[0].storage_limit
              : undefined
          };
          this.estimateFees(recommendations);
          if (this.beaconMode) {
            this.syncSub = this.subjectService.beaconResponse.subscribe((response) => {
              if (response) {
                this.operationResponse.emit('silent');
                this.closeModal();
              }
            });
          }
        } else {
          console.warn('Invalid origination');
          this.operationResponse.emit('parameters_error');
        }
      }
    }
  }
  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
  openModal(): void {
    if (this.walletService.wallet) {
      // hide body scrollbar
      const scrollBarWidth = window.innerWidth - document.body.offsetWidth;
      document.body.style.marginRight = scrollBarWidth.toString();
      document.body.style.overflow = 'hidden';
      this.clearForm();
      if (this.walletService.isLedgerWallet()) {
        this.ledgerError = '?';
      }
      ModalComponent.currentModel.next({ name: this.name, data: null });
    }
  }
  isValidOrigination(): boolean {
    const origination = this.externalRequest.operationRequest.operationDetails[0];
    if (!origination.balance || !this.inputValidationService.amount(origination.balance, 0)) {
      console.warn('invalid balance');
      return false;
    }
    try {
      assertMichelsonContract(origination.script.code);
      assertMichelsonData(origination.script.storage);
    } catch (e) {
      console.warn('Invalid script');
      return false;
    }
    return true;
  }
  async estimateFees(recommendations: any = {}): Promise<void> {
    const callback = (res) => {
      if (res) {
        if (res.error) {
          this.simError = res.error;
          this.formInvalid = this.simError;
        } else {
          this.defaultTransactionParams = res;
        }
      }
      this.simSemaphore--;
    };
    this.simSemaphore++;
    await this.estimateService.preLoadData(this.externalRequest.selectedAccount.pkh, this.externalRequest.selectedAccount.pk);
    this.estimateService.estimateOrigination({ ...this.getOrigination(), ...recommendations }, this.externalRequest.selectedAccount.pkh, callback);
  }
  getOrigination(): {
    balance: string;
    script: string;
    gasLimit: number;
    storageLimit: number;
  } {
    const gasLimit = this.customGas ? Number(this.customGas) : this.defaultTransactionParams.gas;
    const storageLimit = this.customStorage ? Number(this.customStorage) : this.defaultTransactionParams.storage;
    return JSON.parse(
      JSON.stringify({
        balance: this.balance,
        script: this.script,
        gasLimit,
        storageLimit
      })
    );
  }
  getTotalCost(display: boolean = false): string {
    const totalFee = Big(this.getTotalFee()).plus(Big(this.getTotalBurn())).toString();
    if (display && totalFee === '0') {
      return '-';
    }
    return totalFee;
  }
  getTotalFee(): number {
    if (this.customFee !== '' && Number(this.customFee)) {
      return Number(this.customFee);
    }
    return Number(this.defaultTransactionParams.fee);
  }
  getTotalBurn(): number {
    if (this.customStorage !== '' && Number(this.customStorage)) {
      return Number(Big(this.customStorage).times(this.costPerByte).div(1000000).toString());
    }
    return this.defaultTransactionParams.burn;
  }
  burnAmount(): string {
    const burn = this.customStorage ? Number(Big(this.customStorage).times(this.costPerByte).div(1000000)) : this.defaultTransactionParams.burn;
    if (burn) {
      return burn + ' tez';
    }
    return '';
  }
  getScript(): string {
    return this.activeTab
      ? emitMicheline(this.script.storage, {
          indent: '  ',
          newline: '\n'
        })
      : emitMicheline(this.script.code, { indent: '  ', newline: '\n' });
  }
  closeModalAction(): void {
    this.operationResponse.emit(null);
    this.closeModal();
  }
  closeModal(): void {
    ModalComponent.currentModel.next({ name: '', data: null });
    this.clearForm();
    this.messageService?.stopSpinner();
  }
  async inject(): Promise<void> {
    this.formInvalid = this.simError;
    const valid = this.validateOrigination();
    if (valid) {
      const pwd = this.password;
      this.password = '';
      this.messageService.startSpinner('Signing operation...');
      let keys;
      try {
        keys = await this.walletService.getKeys(pwd, this.externalRequest.selectedAccount.pkh);
      } catch {
        this.messageService.stopSpinner();
      }
      if (this.walletService.isLedgerWallet()) {
        this.broadCastLedgerTransaction();
        this.sendResponse = null;
      } else {
        if (keys) {
          this.pwdInvalid = '';
          this.messageService.startSpinner('Sending operation...');
          this.sendOrigination(keys);
          this.closeModal();
        } else {
          this.messageService.stopSpinner();
          if (this.walletService.wallet instanceof TorusWallet) {
            this.pwdInvalid = `Authorization failed`;
          } else {
            this.pwdInvalid = 'Wrong password!';
          }
        }
      }
    }
  }
  validateOrigination(): boolean {
    if (this.simSemaphore) {
      return false;
    } else if (this.formInvalid) {
      return false;
    } else if (!this.inputValidationService.gas(this.customGas)) {
      this.formInvalid = 'Invalid gas limit';
      return false;
    } else if (!this.inputValidationService.storage(this.customStorage)) {
      this.formInvalid = 'Invalid storage limit';
      return false;
    } else if (!this.inputValidationService.amount(this.customFee, 6)) {
      this.formInvalid = 'Invalid fee';
      return false;
    }
    return true;
  }
  async ledgerSign(): Promise<void> {
    this.formInvalid = this.simError;
    const valid = this.validateOrigination();
    if (valid) {
      const keys = await this.walletService.getKeys('');
      if (keys) {
        this.sendOrigination(keys);
      }
    }
  }
  async sendOrigination(keys: KeyPair): Promise<void> {
    //this.fee = '';
    this.subscriptions.add(
      this.operationService.originate(this.getOrigination(), this.getTotalFee(), keys).subscribe(
        async (ans: any) => {
          this.sendResponse = ans;
          if (ans.success === true) {
            if (ans.payload.opHash) {
              this.operationResponse.emit(ans.payload.opHash);
              const metadata = {
                kt1: ans.payload.newPkh,
                opHash: ans.payload.opHash,
                origination: this.externalRequest.operationRequest.operationDetails[0]
              };
              this.coordinatorService.boost(this.externalRequest.selectedAccount.address, metadata);
            } else if (this.walletService.isLedgerWallet()) {
              this.requestLedgerSignature();
            }
          } else {
            this.messageService.stopSpinner();
            console.log('Origination error id ', ans.payload.msg);
            this.messageService.addError(ans.payload.msg, 0);
            this.operationResponse.emit('broadcast_error');
            if (this.walletService.isLedgerWallet) {
              this.closeModal();
            }
          }
        },
        (err) => {
          console.log('Error Message ', JSON.stringify(err));
          this.ledgerError = 'Failed to create operation';
        }
      )
    );
  }
  async requestLedgerSignature(): Promise<void> {
    if (this.walletService.wallet instanceof LedgerWallet) {
      const op = this.sendResponse.payload.unsignedOperation;
      this.messageService.startSpinner('Waiting for Ledger signature');
      let signature;
      try {
        signature = await this.ledgerService.signOperation('03' + op, this.walletService.wallet.implicitAccounts[0].derivationPath);
      } finally {
        this.messageService.stopSpinner();
      }
      if (signature) {
        const signedOp = op + signature;
        this.sendResponse.payload.signedOperation = signedOp;
        this.ledgerError = '';
      } else {
        this.ledgerError = 'Failed to sign operation';
      }
    }
  }
  async broadCastLedgerTransaction(): Promise<void> {
    this.messageService.startSpinner('Broadcasting operation');
    this.subscriptions.add(
      this.operationService.broadcast(this.sendResponse.payload.signedOperation).subscribe(
        (ans: any) => {
          this.sendResponse = ans;
          if (ans.success && this.externalRequest.selectedAccount.address) {
            const metadata = {
              kt1: ans.payload.newPkh,
              opHash: ans.payload.opHash,
              origination: this.externalRequest.operationRequest.operationDetails[0]
            };
            this.coordinatorService.boost(this.externalRequest.selectedAccount.address, metadata);
          } else {
            this.messageService.addError(this.sendResponse.payload.msg, 0);
            this.operationResponse.emit('broadcast_error');
          }
          this.closeModal();
          console.log('ans: ' + JSON.stringify(ans));
        },
        (error) => {
          this.messageService.stopSpinner();
          this.messageService.addError(error, 0);
          this.operationResponse.emit('broadcast_error');
        }
      )
    );
  }
  clearForm(): void {
    this.defaultTransactionParams = zeroTxParams;
    this.customFee = '';
    this.customGas = '';
    this.customStorage = '';

    this.balance = '';
    this.script = null;

    this.advancedForm = false;

    this.password = '';
    this.pwdInvalid = '';
    this.formInvalid = '';
    this.simError = '';

    this.sendResponse = null;
    this.ledgerError = '';
    this.simSemaphore = 0;
    this.activeTab = 0;

    if (this.syncSub) {
      this.syncSub.unsubscribe();
      this.syncSub = undefined;
    }
  }
  // Only Numbers with Decimals
  keyPressNumbersDecimal(event, input): boolean {
    const charCode = event.which ? event.which : event.keyCode;
    if (charCode !== 46 && charCode > 31 && (charCode < 48 || charCode > 57)) {
      event.preventDefault();
      return false;
    } else if (charCode === 46 && this[input].length === 0) {
      this[input] = '0' + this[input];
    }
    return true;
  }
}
