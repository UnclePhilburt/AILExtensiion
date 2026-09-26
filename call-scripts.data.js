// Spoken lines from the Salebase phone scripts, with the lead's own details
// left as {firstName}, {address}, and similar fill-ins.
export const CALL_SCRIPTS = [
  {
    "id": "RESPONSE",
    "label": "Response Card",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent} with American Income Life. We handle some of your benefits through {group}."
      },
      {
        "title": "REASON FOR MEETING",
        "body": "They sent you a letter about this and you sent back a reply card. I just need to verify the information that you wrote down. Now, {firstName}, you wrote down your address as {address}. Is that correct? Okay great! You also wrote down your date of birth as DOB. Is that correct? Awesome! For the beneficiary of the life insurance policy, you wrote down {beneficiary}. Is that still correct? Perfect!\nIt looks like you're one of the members who hasn't received their benefits package yet. It's my job to explain the benefits, activate the permanent ones, and get you caught up."
      }
    ]
  },
  {
    "id": "WILLKIT",
    "label": "Will Kit",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent}, with American Income Life. We provide the Will Kit that you requested from TheFreeWillKit.com."
      },
      {
        "title": "REASON FOR CALLING",
        "body": "I'm calling to let you know that the Will Kits you ordered have just arrived! First I'll need to verify the information that you provided. You listed your street address as {address} and your email address as EMAIL. Is that correct? Then it looks like you ordered # Will Kit(s). Is that correct?\nIf they say: 1 Will Kit\nIf they say: 2 Will Kits\nDo you have a spouse or significant other? (If Yes): I'll give you one for them as well.Perfect — I'll have that one ready for you.\nIs the other will kit for your spousesomeone else? Okay, what's their name?\nNow, {firstName}, did you request this program because you just recently lost a loved one, or are you trying to be proactive? GIVE A GENUINE COMPLIMENT\nIf they say: Lost Loved One\nIf they say: Proactive\nI am very sorry for your loss. I'll be sure to make you a priority today.\nThat's a very good decision! I'll be sure to make you a priority today.\n{firstName}, I'll briefly go over the Will Kit and make sure you know where to get it notarized. That way your family doesn't end up in probate court."
      }
    ]
  },
  {
    "id": "CHILDSAFE",
    "label": "Child Safe",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent} with the Child Safe Division of American Income Life calling about the Child Safe Kits that you requested online — you probably remember doing that through Facebook. When you filled out the form you requested # child safe kits. Is that correct?"
      },
      {
        "title": "REASON FOR MEETING",
        "body": "Perfect! Over 2,000 children go missing every day in the U.S. and these kits double their chances of a safe return, so we need to get these set up as quickly as possible — the first part of the program is to protect your children if anything were to happen to them, and the second part of the program is designed to protect the kids in case anything happens to you. Most families like to take care of this right away."
      }
    ]
  },
  {
    "id": "MPCHILDSAFE",
    "label": "MediaPlex Child Safe",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent} with the Child Safe Division- I'm calling because you requested the Child Safe ID Kits online a little bit ago- Now, did you get those kits for your kids or for your grandkids?"
      },
      {
        "title": "REASON FOR MEETING",
        "body": "These kits are provided at no cost to you becuase they are endorsed by the International Union of Police Associations Associations and the American Federation of Teachers. So, I have you down at {address}, is that correct? Also, looks like you requested # child safe kits did you only need that amount or did you have a few more kids? Okay Perfect.\nI do have the kits. My job is to deliver and review the entire Child Safe program and mobile app. In fact, so many parents have even been asking about how to get their hands on the list of sexual offenders and predators in their area... So I'm going to make sure you see how that works as well."
      }
    ]
  },
  {
    "id": "REFERRAL",
    "label": "Referral",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent} with American Income Life. I just spoke with (Sponsor) and the reason I'm calling you now is because they sponsored you for some very important benefits for your family through {group}! They told you about this, right?\nIf they say: Yes\nIf they say: No\nGreat!\nThey didn't? Act surprised Well, (Sponsor) promised me they would tell you about it! No worries though! They probably wanted me to explain it to you personally."
      },
      {
        "title": "REASON FOR MEETING",
        "body": "Let me fill you in! (Sponsor) has given you some benefits that are usually only available to unions and special groups like the police, firefighters, and teachers. I gave my word to (Sponsor) that I would get these out to you and explain everything. The only problem is that I'm getting very busy. I decided to call you now so that we don't miss you altogether. Are you single or do you have a significant other?"
      }
    ]
  },
  {
    "id": "POS",
    "label": "POS",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent} with American Income Life, your life insurance company, how are you doing? The reason I'm calling is to set up a review on your policy. So that way you know where your money is going, answer any questions you have and also update your claim forms. Now, do you remember that Freedom of Choice certificate?\nIf they say: Yes\nIf they say: No\nOk, great because that's the certificate that will take care of your funeral costs for your family.\nOk, well don't feel bad—most members actually forget about it, and that's exactly why I'm calling. This is the certificate that will take care of your funeral costs for your family.\nI'll be able to help you copy the policy number over to the back of that certificate and organize your folder. That way your family never has to worry about digging through papers looking for policy numbers or trying to contact insurance companies. I'll also review your policy with you and reeducate you about how all this stuff works."
      }
    ]
  },
  {
    "id": "LAPSED-POS",
    "label": "Lapsed POS",
    "steps": [
      {
        "title": "Hi, is {firstName} there? Hey {firstName}, I'm glad I finally got ahold of you, ",
        "body": "It looks like you had a really good plan…do you happen to know or remember why it lapsed?\nIf they say: Issue with an agent\nIf they say: Couldn't afford it\nIf they say: Issue with the company\nThat's what I assumed and that's why I'm calling. The company wanted to give you a chance to work with one of the Servicing Managers on this…\nThat's what I assumed and that's why I'm calling. I already see a couple of ideas where we might be able to save you some money.\nThat's what I assumed and that's why I'm calling. Let me first apologize and also let you know that it's why they wanted to give you a chance to work with one of the Servicing Managers on this…\nSince it's so rare that a policy would fall off like this, and even though it isn't your enrollment period, I wanted to meet with you personally, introduce myself to you, go over a few ideas with you, and if it makes sense, get the coverage back in place for you and for your family."
      }
    ]
  },
  {
    "id": "BENEFICIARY",
    "label": "Beneficiary",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent} with American Income Life. I just spoke with (Sponsor) and they listed you as one of the beneficiaries on their life insurance policy. They told you about this, right?\nYes or No: Okay, that's exactly why I'm calling you. They wanted me to explain it to you personally. We actually sat down with (Sponsor) the other day to review their insurance through their {group} insert rapport reference here"
      },
      {
        "title": "REASON FOR CALLING",
        "body": "It's my job make sure that you accept responsibility of being the beneficiary and explain everything. Do you\naccept responsibility of that? I'll also get you the forms so if anything happens to (Sponsor) you'll be able to make a claim and take care of things for their family. Also, as a beneficiary on their policy, that gives you access to some of the benefits for you and your family; you'll just have to qualify for them.\nI gave my word to (Sponsor) that I would get out to you and explain everything. The only problem is that I'm gettng very busy. I decided to call you now so that we don't miss you altogether."
      }
    ]
  },
  {
    "id": "GLOBE",
    "label": "Globe",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent} your agent with Globe Life!"
      },
      {
        "title": "REASON FOR MEETING",
        "body": "I'm reaching out because we got your request to speak with an agent about our life insurance options and we wanted to follow up and ask, are you looking for life insurance for yourself or someone else?\nIf they say: Myself\nIf they say: Someone else\nAre you looking to protect your family from paying out of pocket for your Final Expenses, or was it because you wanted to leave some money behind for your family?\nAre you looking to cover their Final Expenses, or was it because you wanted to leave a nest egg for their family?\nBefore we get started, let me verify everything that you listed on your request. You listed your address as {address}. Is that correct? You listed your full name as {fullName}. Is that correct? It looks like you didn't put down your DOB. So, what's your DOB? Great and are you currently single, married or have a significant other?\nOkay great, {firstName}! What I'm going to do for you is explain the different options that we have and do a quick needs analysis to see what makes the most sense for your situation."
      }
    ]
  },
  {
    "id": "GLOBELAPSE",
    "label": "Globe Lapse",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent} with Globe Life Insurance, how are you doing today?\nI'm giving you a call because your policy with Globe came across my desk for update and review. I just need to verify the information we have on record and I'll have you off the phone real quick.\n• First, you listed your address as {address}, is that correct?\n• You listed your Date of Birth as (DOB), is that correct?\n• And it looks like there's no beneficiary on file. So, we need to update that for you. not over the phone, this is used as another reason for the meeting"
      },
      {
        "title": "REASON FOR MEETING",
        "body": "Well {firstName}, the whole reason for my call is it appears that your coverage with Globe has lapsed and is up for review and renewal. Obviously you had this in place to take care of your family and we're going to make sure that stays the case. Plus, we'll need to confirm your beneficiary designation - that's part of why we do these reviews. It won't take long at all but they have me review policy options with other Globe members in your area over the next few days."
      }
    ]
  },
  {
    "id": "APLUS",
    "label": "AIL Plus",
    "steps": [
      {
        "title": "Hey, {firstName}??! Hey {firstName}, this is {agent}The reason I am calling is b",
        "body": "OK, just to refresh you, the benefits provide discounts of up to 85% on things like eyeglasses, chiropractic services, prescription drugs, and dental care. And {firstName}, just to make sure everything is still the same:\n• do you still live at {address}?\n• And your date or birth is (DOB), right?\n• Also, I have your email address down as {email}, is that correct?\nLike I said it's just my job to handle the renewal and to get you your updated benefits."
      }
    ]
  },
  {
    "id": "AILPLUS-NONCUST",
    "label": "AIL Plus (not a customer)",
    "steps": [
      {
        "title": "Hey, {firstName}??! Hey {firstName}, this is {agent}The reason I am calling is b",
        "body": "OK, just to refresh you, the benefits provide discounts of up to 85% on things like eyeglasses, chiropractic services, prescription drugs, and dental care. And {firstName}, just to make sure everything is still the same:\n• do you still live at {address}?\n• And your date or birth is (DOB), right?\n• Also, I have your email address down as {email}, is that correct?\nLike I said it's just my job to handle the renewal and to get you your updated benefits."
      }
    ]
  },
  {
    "id": "FE",
    "label": "Final Expense",
    "steps": [
      {
        "title": "INTRO",
        "body": "Hey, {firstName}??! Hey {firstName}, this is {agent}. I'm calling on the request you sent in for final expense coverage —I just need to verify a couple quick details on your request so I can get you over some info.\n• Is your address still {address}?\n• And you listed (Beneficiary Name) to be in charge of your arrangements, is that still correct?\nPerfect. So here's how this works — my job is to get you some quick information through a quick Zoom appointment so you can have it for your notes and answer any questions you may have."
      }
    ]
  }
];
