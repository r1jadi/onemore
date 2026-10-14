import {
  Accessibility,
  Bell,
  Globe,
  HelpCircle,
  Info,
  Link2,
  Lock,
  Palette,
  Shield,
  ShieldOff,
  User,
  UserCircle,
  FileText,
  ScrollText,
} from "lucide-react";

export const settingsGroups = [
  {
    label: "Account",
    items: [
      { slug: "account", title: "Account", desc: "Email, phone, password", icon: User },
      { slug: "profile", title: "Profile", desc: "Photo, name, bio", icon: UserCircle },
      {
        slug: "security",
        title: "Security",
        desc: "Two-step verification, sessions",
        icon: Shield,
      },
      { slug: "connected", title: "Connected accounts", desc: "Google", icon: Link2 },
    ],
  },
  {
    label: "Preferences",
    items: [
      { slug: "privacy", title: "Privacy", desc: "Who can see your activity", icon: Lock },
      { slug: "notifications", title: "Notifications", desc: "Push and email", icon: Bell },
      { slug: "language", title: "Language", desc: "English, Polski", icon: Globe },
      { slug: "appearance", title: "Appearance", desc: "Dark, light, system", icon: Palette },
      {
        slug: "accessibility",
        title: "Accessibility",
        desc: "Motion, contrast, text size",
        icon: Accessibility,
      },
      { slug: "blocked", title: "Blocked users", desc: "People you've blocked", icon: ShieldOff },
    ],
  },
  {
    label: "Support",
    items: [
      { slug: "help", title: "Help", desc: "FAQ and contact", icon: HelpCircle },
      { slug: "terms", title: "Terms & Conditions", desc: "", icon: ScrollText },
      { slug: "privacy-policy", title: "Privacy Policy", desc: "", icon: FileText },
      { slug: "about", title: "About", desc: "Version and source", icon: Info },
    ],
  },
];

export const allSettings = settingsGroups.flatMap((g) => g.items);
