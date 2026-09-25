// Lines Cody pasted from the real Salebase phone scripts (three scripts),
// trimmed to the sentences around each placeholder. Shared by the Node and
// headless-browser tests (plain script: defines a global).
var SALEBASE_SCRIPT_TEXT = {
  union: [
    'Hey, (Member)??! Hey (Member), this is Cody with American Income Life.',
    'We handle some of your benefits through (Group).',
    "I'm reaching out because you're one of the members who hasn't received their benefits yet.",
    'Okay great, (Member)!',
    'You listed your full name as NAME.',
    'You also wrote down your date of birth as DOB.',
    'You listed your address as (ADDRESS).'
  ],
  beneficiary: [
    'Hey (Member), this is Cody.',
    'Now, (Member), you wrote down your address as (ADDRESS).',
    'For the beneficiary on your coverage, you wrote down (Beneficiary).',
    "It looks like you didn't put down your DOB. So, what's your DOB?"
  ],
  childSafe: [
    'Hey (Member), this is Cody.',
    'It looks like you requested # child safe kits.',
    'Now, (Member), you wrote down your address as (ADDRESS).'
  ]
};
if (typeof module !== 'undefined') module.exports = { SALEBASE_SCRIPT_TEXT };
