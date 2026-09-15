/** First-run setup wizard — creates the business workspace atomically.
 *  No fake data is created: only what the user types (§128). */
import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { BrandMark } from '../../App';
import { Button, Field, MoneyInput, TextInput, SelectInput } from '../../ui';
import { useSession } from '../../lib/session';
import { api, errMsg } from '../../lib/api';
import { useToast } from '../../ui';
import { toPaise } from '@shared/money';

const STEPS = ['ব্যবসার তথ্য', 'প্রারম্ভিক ব্যালেন্স', 'অ্যাকাউন্ট'];

export function SetupWizard() {
  const toast = useToast();
  const { login, business } = useSession();
  const [step, setStep] = useState(0);

  // step 1
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [businessType, setBusinessType] = useState('retail');
  // step 2
  const [opCash, setOpCash] = useState(0);
  const [opBank, setOpBank] = useState(0);
  const [opBkash, setOpBkash] = useState(0);
  const [opNagad, setOpNagad] = useState(0);
  const [opRocket, setOpRocket] = useState(0);
  const [opUpay, setOpUpay] = useState(0);
  // step 3
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);

  const step1Ok = name.trim().length > 0 && ownerName.trim().length > 0;
  const step3Ok = username.trim().length > 0 && password.length >= 4 && password === password2;

  async function finish() {
    setBusy(true);
    try {
      await api.setup.create({
        name: name.trim(),
        ownerName: ownerName.trim(),
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        businessType,
        adminUsername: username.trim(),
        adminPassword: password,
        openingBalances: {
          cash: toPaise(opCash),
          bank: toPaise(opBank),
          bkash: toPaise(opBkash),
          nagad: toPaise(opNagad),
          rocket: toPaise(opRocket),
          upay: toPaise(opUpay)
        }
      });
      const status = await api.auth.status();
      if (status.business) {
        await login(status.business.id, username.trim(), password);
        toast('success', 'ব্যবসা সেটআপ সম্পন্ন', 'MERQO এখন প্রস্তুত।');
      }
    } catch (e) {
      toast('error', 'সেটআপ সম্পন্ন হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wizard fade-up">
      <div className="wizard-head">
        <BrandMark size={44} />
        <div>
          <h1>MERQO সেটআপ</h1>
          <div style={{ color: 'var(--c-ink-3)', fontSize: 'var(--fs-sm)' }}>
            আপনার ব্যবসা শুরু করতে তিনটি ধাপ — সব ডেটা এই কম্পিউটারেই থাকবে
          </div>
        </div>
      </div>

      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`step${i <= step ? ' done' : ''}`} title={s} />
        ))}
      </div>

      <div className="wizard-body">
        {step === 0 && (
          <>
            <Field label="ব্যবসার নাম *">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমন: আলাউদ্দিন স্টোর" autoFocus />
            </Field>
            <div className="form-2col">
              <Field label="মালিক / ব্যবসায়ীর নাম *">
                <TextInput value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="যেমন: মো. আলাউদ্দিন" />
              </Field>
              <Field label="ফোন">
                <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="০১XXXXXXXXX" inputMode="tel" />
              </Field>
            </div>
            <Field label="ঠিকানা">
              <TextInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="বাজার, থানা, জেলা" />
            </Field>
            <Field label="ব্যবসার ধরন">
              <SelectInput value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                <option value="retail">খুচরা দোকান</option>
                <option value="grocery">কম্বল / লেন্ডিং শপ</option>
                <option value="wholesale">পাইকারি ব্যবসা</option>
                <option value="other">অন্যান্য</option>
              </SelectInput>
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <p style={{ color: 'var(--c-ink-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>
              হাতে থাকা টাকা / ব্যালেন্স লিখুন। খালি রাখলে সবশূন্য থেকে শুরু হবে — পরে যখন খুশি
              হিসাব খুলে নতুন ব্যালেন্স যোগ করা যাবে।
            </p>
            <div className="opening-grid">
              <Field label="নগদ (ক্যাশ)">
                <MoneyInput value={opCash} onValue={setOpCash} placeholder="০" autoFocus />
              </Field>
              <Field label="ব্যাংক">
                <MoneyInput value={opBank} onValue={setOpBank} placeholder="০" />
              </Field>
              <Field label="bKash">
                <MoneyInput value={opBkash} onValue={setOpBkash} placeholder="০" />
              </Field>
              <Field label="Nagad">
                <MoneyInput value={opNagad} onValue={setOpNagad} placeholder="০" />
              </Field>
              <Field label="Rocket">
                <MoneyInput value={opRocket} onValue={setOpRocket} placeholder="০" />
              </Field>
              <Field label="Upay">
                <MoneyInput value={opUpay} onValue={setOpUpay} placeholder="০" />
              </Field>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p style={{ color: 'var(--c-ink-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>
              মালিক হিসেবে লগইন অ্যাকাউন্ট তৈরি করুন। এতে সম্পূর্ণ অ্যাক্সেস থাকবে; পরে আরো
              ক্যাশিয়ার / ম্যানেজার যোগ করতে পারবেন।
            </p>
            <Field label="ইউজারনেম *">
              <TextInput value={username} onChange={(e) => setUsername(e.target.value)} placeholder="যেমন: alauddin" autoFocus />
            </Field>
            <div className="form-2col">
              <Field label="পাসওয়ার্ড *" hint="কমপক্ষে ৪ অক্ষর">
                <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="পাসওয়ার্ড আবার" error={password2.length > 0 && password !== password2 ? 'পাসওয়ার্ড মিলছে না' : undefined}>
                <TextInput type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
              </Field>
            </div>
          </>
        )}
      </div>

      <div className="wizard-foot">
        <Button variant="ghost" icon={<ArrowLeft size={16} />} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          পিছনে
        </Button>
        {step < 2 ? (
          <Button variant="primary" icon={<ArrowRight size={16} />} disabled={step === 0 && !step1Ok} onClick={() => setStep((s) => s + 1)}>
            এগিয়ে যান
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={<Check size={16} />}
            loading={busy}
            disabled={!step3Ok}
            onClick={finish}
          >
            ব্যবসা শুরু করুন
          </Button>
        )}
      </div>
    </div>
  );
}
