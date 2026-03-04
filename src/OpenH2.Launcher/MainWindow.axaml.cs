using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Markup.Xaml;
using OpenH2.Launcher.ViewModels;
using PropertyChanged;

namespace OpenH2.Launcher
{
    [DoNotNotify]
    public class MainWindow : Window
    {
        public MainWindow()
        {
            InitializeComponent();
#if DEBUG
            this.AttachDevTools();
#endif

            this.DataContext = new MainWindowViewModel(this);

            var listBox = this.FindControl<ListBox>("mapListBox");
            if (listBox != null)
            {
                listBox.DoubleTapped += ListBox_DoubleTapped;
            }
        }

        private void InitializeComponent()
        {
            AvaloniaXamlLoader.Load(this);
        }

        private void ListBox_DoubleTapped(object sender, TappedEventArgs e)
        {
            if (this.DataContext is MainWindowViewModel vm)
            {
                vm.Launch();
            }
        }
    }
}
